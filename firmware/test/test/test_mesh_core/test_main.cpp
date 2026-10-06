#include <unity.h>
#include "pm_dedup.h"
#include "pm_neighbors.h"
#include "pm_time.h"

void setUp() {}
void tearDown() {}

// --- dedup -----------------------------------------------------------

static void test_first_frame_is_new() {
  PmDedup d;
  TEST_ASSERT_FALSE(d.seen(0xAABB, 1, 0));
}

static void test_exact_repeat_is_dupe() {
  PmDedup d;
  d.seen(0xAABB, 7, 0);
  TEST_ASSERT_TRUE(d.seen(0xAABB, 7, 1));
}

// The case the flood actually generates: the same frame arriving over
// several relay paths, interleaved with other traffic.
static void test_duplicate_after_interleaved_traffic() {
  PmDedup d;
  d.seen(0xAABB, 10, 0);
  for (uint16_t s = 1; s <= 5; s++) d.seen(0xCCDD, s, 1);
  TEST_ASSERT_TRUE(d.seen(0xAABB, 10, 2));
}

// Out-of-order delivery is normal with jittered relays: an older seq
// that has not been seen must still be accepted.
static void test_out_of_order_within_window() {
  PmDedup d;
  d.seen(0xAABB, 10, 0);
  TEST_ASSERT_FALSE(d.seen(0xAABB, 8, 1));
  TEST_ASSERT_TRUE(d.seen(0xAABB, 8, 2));
  TEST_ASSERT_FALSE(d.seen(0xAABB, 9, 3));
}

static void test_older_than_window_rejected() {
  PmDedup d;
  d.seen(0xAABB, 100, 0);
  TEST_ASSERT_TRUE(d.seen(0xAABB, 60, 1));  // 40 back, window is 32
}

static void test_sequence_wraparound() {
  PmDedup d;
  TEST_ASSERT_FALSE(d.seen(0xAABB, 65534, 0));
  TEST_ASSERT_FALSE(d.seen(0xAABB, 65535, 1));
  TEST_ASSERT_FALSE(d.seen(0xAABB, 0, 2));  // wrapped, still forward
  TEST_ASSERT_FALSE(d.seen(0xAABB, 1, 3));
  TEST_ASSERT_TRUE(d.seen(0xAABB, 65535, 4));  // now behind, already seen
}

// A rebooted node restarts its counter at 1; without this its frames
// would look like ancient duplicates and be dropped forever.
static void test_source_reboot_is_accepted() {
  PmDedup d;
  d.seen(0xAABB, 40000, 0);
  TEST_ASSERT_FALSE(d.seen(0xAABB, 1, 1));
  TEST_ASSERT_FALSE(d.seen(0xAABB, 2, 2));
}

// The bench bug of 2026-10-05: a bridge reset a few minutes in (counter
// ~300, far below PM_REBOOT_GAP) restarted at 1 and every frame it sent
// looked like an old duplicate. A new boot_id must reset the window at
// once, whatever the numbers.
static void test_new_boot_id_resets_window() {
  PmDedup d;
  for (uint16_t s = 1; s <= 300; s++) d.seen(0xAABB, s, s, 0x1111);
  TEST_ASSERT_FALSE(d.seen(0xAABB, 1, 400, 0x2222));  // restarted: new
  TEST_ASSERT_FALSE(d.seen(0xAABB, 2, 401, 0x2222));
  TEST_ASSERT_TRUE(d.seen(0xAABB, 2, 402, 0x2222));   // and dedup still works
}

// A reset seconds after boot — new counter within the old window.
static void test_quick_reboot_within_window() {
  PmDedup d;
  for (uint16_t s = 1; s <= 10; s++) d.seen(0xAABB, s, s, 0x1111);
  TEST_ASSERT_FALSE(d.seen(0xAABB, 1, 20, 0x3333));
  TEST_ASSERT_FALSE(d.seen(0xAABB, 2, 21, 0x3333));
}

// The same boot id: an old copy is still a duplicate.
static void test_same_boot_id_keeps_dedup() {
  PmDedup d;
  for (uint16_t s = 1; s <= 300; s++) d.seen(0xAABB, s, s, 0x1111);
  TEST_ASSERT_TRUE(d.seen(0xAABB, 1, 400, 0x1111));
}

static void test_sources_are_independent() {
  PmDedup d;
  d.seen(0xAABB, 5, 0);
  TEST_ASSERT_FALSE(d.seen(0xCCDD, 5, 0));
}

// More nodes than slots: the table must keep working, evicting the
// least recently heard rather than refusing new sources.
static void test_source_table_evicts_stalest() {
  PmDedup d;
  for (uint32_t i = 0; i < PM_MAX_SOURCES; i++) d.seen(0x1000 + i, 1, i);
  TEST_ASSERT_EQUAL_UINT8(PM_MAX_SOURCES, d.tracked());
  d.seen(0x9999, 1, 1000);
  TEST_ASSERT_EQUAL_UINT8(PM_MAX_SOURCES, d.tracked());
  TEST_ASSERT_TRUE(d.seen(0x9999, 1, 1001));   // newcomer retained
  TEST_ASSERT_FALSE(d.seen(0x1000, 1, 1002));  // stalest was evicted
}

// --- neighbors -------------------------------------------------------

static void test_neighbor_observed_and_reported() {
  PmNeighbors n;
  n.observe(0xAABB, -50, 0);
  pm_neighbor_t out[PM_MAX_NEIGHBORS];
  TEST_ASSERT_EQUAL_UINT8(1, n.snapshot(out, PM_MAX_NEIGHBORS, 0));
  TEST_ASSERT_EQUAL_UINT32(0xAABB, out[0].node_id);
  TEST_ASSERT_EQUAL_INT8(-50, out[0].rssi);
}

static void test_neighbor_rssi_is_smoothed() {
  PmNeighbors n;
  n.observe(0xAABB, -40, 0);
  n.observe(0xAABB, -80, 1);  // one bad sample must not swing it fully
  pm_neighbor_t out[PM_MAX_NEIGHBORS];
  n.snapshot(out, PM_MAX_NEIGHBORS, 1);
  TEST_ASSERT_TRUE(out[0].rssi > -60);
  TEST_ASSERT_TRUE(out[0].rssi < -40);
}

static void test_neighbor_ages_out() {
  PmNeighbors n;
  n.observe(0xAABB, -50, 0);
  pm_neighbor_t out[PM_MAX_NEIGHBORS];
  TEST_ASSERT_EQUAL_UINT8(0, n.snapshot(out, PM_MAX_NEIGHBORS,
                                        PM_NEIGHBOR_TTL_MS + 1));
}

static void test_neighbors_sorted_strongest_first() {
  PmNeighbors n;
  n.observe(0x1, -80, 0);
  n.observe(0x2, -40, 0);
  n.observe(0x3, -60, 0);
  pm_neighbor_t out[PM_MAX_NEIGHBORS];
  TEST_ASSERT_EQUAL_UINT8(3, n.snapshot(out, PM_MAX_NEIGHBORS, 0));
  TEST_ASSERT_EQUAL_UINT32(0x2, out[0].node_id);
  TEST_ASSERT_EQUAL_UINT32(0x3, out[1].node_id);
  TEST_ASSERT_EQUAL_UINT32(0x1, out[2].node_id);
}

// --- clock -----------------------------------------------------------

static void test_unsynced_adopts_anything() {
  PmClock c;
  TEST_ASSERT_TRUE(c.should_adopt(0x100, 0, 3, 0));
}

static void test_higher_conductor_id_wins() {
  PmClock c;
  c.adopt(0x100, 0, 1, 5000, 0);
  TEST_ASSERT_TRUE(c.should_adopt(0x200, 0, 2, 0));   // higher id, worse hop
  TEST_ASSERT_FALSE(c.should_adopt(0x050, 0, 0, 0));  // lower id, better hop
}

static void test_closer_path_to_same_conductor_wins() {
  PmClock c;
  c.adopt(0x100, 0, 3, 5000, 0);
  TEST_ASSERT_TRUE(c.should_adopt(0x100, 0, 1, 0));
  TEST_ASSERT_FALSE(c.should_adopt(0x100, 0, 4, 0));
}

// If the conductor dies mid-show, any beacon beats none.
static void test_stale_sync_adopts_lesser_conductor() {
  PmClock c;
  c.adopt(0x200, 0, 0, 5000, 0);
  TEST_ASSERT_FALSE(c.should_adopt(0x050, 0, 1, 100));
  TEST_ASSERT_TRUE(c.should_adopt(0x050, 0, 1, PM_SYNC_STALE_MS + 1));
}

static void test_first_sync_jumps_then_smooths() {
  PmClock c;
  c.adopt(0x100, 0, 1, 10000, 0);
  TEST_ASSERT_EQUAL_INT64(10000, c.offset_us());
  c.adopt(0x100, 0, 1, 10400, 1);  // small correction: smoothed, not stepped
  TEST_ASSERT_EQUAL_INT64(10100, c.offset_us());
}

static void test_large_delta_jumps() {
  PmClock c;
  c.adopt(0x100, 0, 1, 0, 0);
  c.adopt(0x100, 0, 1, PM_SYNC_JUMP_US * 2, 1);
  TEST_ASSERT_EQUAL_INT64(PM_SYNC_JUMP_US * 2, c.offset_us());
}

static void test_mesh_and_local_time_round_trip() {
  PmClock c;
  c.adopt(0x100, 0, 1, 12345, 0);
  TEST_ASSERT_EQUAL_INT64(1012345, c.mesh_us(1000000));
  TEST_ASSERT_EQUAL_INT64(1000000, c.local_us(1012345));
}

static void test_conductor_is_its_own_authority() {
  PmClock c;
  c.become_conductor(0xABC, 0, 0);
  TEST_ASSERT_TRUE(c.is_conductor());
  TEST_ASSERT_EQUAL_INT64(0, c.offset_us());
  TEST_ASSERT_EQUAL_INT64(500, c.mesh_us(500));
}

// A bridge (priority 1) wins the election over any plain node, whatever
// the ids — so the mesh clock lives on the bridge when there is one.
static void test_bridge_outranks_higher_id() {
  PmClock c;
  c.adopt(0xFFFFFF00, 0, 1, 0, 0);
  TEST_ASSERT_TRUE(c.should_adopt(0x00000010, 1, 3, 0));
  c.adopt(0x00000010, 1, 3, 0, 0);
  TEST_ASSERT_FALSE(c.should_adopt(0xFFFFFFFF, 0, 0, 0));
  TEST_ASSERT_TRUE(PmClock::rank(1, 0x10) > PmClock::rank(0, 0xFFFFFFFF));
}

static void test_resigned_conductor_follows() {
  PmClock c;
  c.become_conductor(0xABC, 0, 0);
  c.resign();
  TEST_ASSERT_FALSE(c.is_conductor());
  TEST_ASSERT_TRUE(c.should_adopt(0x001, 0, 2, 0));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_first_frame_is_new);
  RUN_TEST(test_exact_repeat_is_dupe);
  RUN_TEST(test_duplicate_after_interleaved_traffic);
  RUN_TEST(test_out_of_order_within_window);
  RUN_TEST(test_older_than_window_rejected);
  RUN_TEST(test_sequence_wraparound);
  RUN_TEST(test_source_reboot_is_accepted);
  RUN_TEST(test_sources_are_independent);
  RUN_TEST(test_new_boot_id_resets_window);
  RUN_TEST(test_quick_reboot_within_window);
  RUN_TEST(test_same_boot_id_keeps_dedup);
  RUN_TEST(test_source_table_evicts_stalest);
  RUN_TEST(test_neighbor_observed_and_reported);
  RUN_TEST(test_neighbor_rssi_is_smoothed);
  RUN_TEST(test_neighbor_ages_out);
  RUN_TEST(test_neighbors_sorted_strongest_first);
  RUN_TEST(test_unsynced_adopts_anything);
  RUN_TEST(test_higher_conductor_id_wins);
  RUN_TEST(test_closer_path_to_same_conductor_wins);
  RUN_TEST(test_stale_sync_adopts_lesser_conductor);
  RUN_TEST(test_first_sync_jumps_then_smooths);
  RUN_TEST(test_large_delta_jumps);
  RUN_TEST(test_mesh_and_local_time_round_trip);
  RUN_TEST(test_conductor_is_its_own_authority);
  RUN_TEST(test_bridge_outranks_higher_id);
  RUN_TEST(test_resigned_conductor_follows);
  return UNITY_END();
}
