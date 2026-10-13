#include <unity.h>
#include <string>
#include "pm_reassembly.h"

void setUp() {}
void tearDown() {}

static PmReassembly R;

static std::string text(size_t n) {
  std::string s;
  for (size_t i = 0; i < n; i++) s += (char)('a' + i % 26);
  return s;
}

static const char *feed(PmReassembly &r, uint32_t src, uint16_t id,
                        const std::string &msg, uint8_t chunk, uint32_t now = 0) {
  uint8_t n = pm_api_chunk_count(msg.size());
  size_t off = chunk * PM_API_CHUNK;
  size_t len = msg.size() - off < PM_API_CHUNK ? msg.size() - off : PM_API_CHUNK;
  return r.add(src, id, chunk, n, (const uint8_t *)msg.data() + off, (uint8_t)len, now);
}

static void test_chunk_count() {
  TEST_ASSERT_EQUAL(1, pm_api_chunk_count(0));
  TEST_ASSERT_EQUAL(1, pm_api_chunk_count(PM_API_CHUNK));
  TEST_ASSERT_EQUAL(2, pm_api_chunk_count(PM_API_CHUNK + 1));
  TEST_ASSERT_EQUAL(PM_API_MAX_CHUNKS, pm_api_chunk_count(PM_API_MAX_BYTES));
  TEST_ASSERT_EQUAL(0, pm_api_chunk_count(PM_API_MAX_BYTES + 1));
}

static void test_single_chunk() {
  PmReassembly r;
  const char *m = feed(r, 1, 7, "{\"cmd\":\"hello\"}", 0);
  TEST_ASSERT_EQUAL_STRING("{\"cmd\":\"hello\"}", m);
}

// The flood delivers chunks out of order and repeats them.
static void test_out_of_order_with_duplicates() {
  PmReassembly r;
  std::string msg = text(PM_API_CHUNK * 3 + 17);
  TEST_ASSERT_NULL(feed(r, 1, 9, msg, 2));
  TEST_ASSERT_NULL(feed(r, 1, 9, msg, 0));
  TEST_ASSERT_NULL(feed(r, 1, 9, msg, 2));  // dupe
  TEST_ASSERT_NULL(feed(r, 1, 9, msg, 3));
  const char *m = feed(r, 1, 9, msg, 1);
  TEST_ASSERT_NOT_NULL(m);
  TEST_ASSERT_EQUAL_STRING(msg.c_str(), m);
  // A late duplicate after completion must not re-deliver.
  TEST_ASSERT_NULL(feed(r, 1, 9, msg, 3));
}

static void test_interleaved_sources() {
  PmReassembly r;
  std::string a = text(PM_API_CHUNK + 5), b = text(PM_API_CHUNK * 2);
  TEST_ASSERT_NULL(feed(r, 1, 1, a, 0));
  TEST_ASSERT_NULL(feed(r, 2, 1, b, 1));
  TEST_ASSERT_EQUAL_STRING(a.c_str(), feed(r, 1, 1, a, 1));
  TEST_ASSERT_EQUAL_STRING(b.c_str(), feed(r, 2, 1, b, 0));
}

// A lost chunk must not wedge a slot forever.
static void test_abandoned_message_times_out() {
  PmReassembly r;
  std::string a = text(PM_API_CHUNK * 2);
  for (uint16_t id = 1; id <= PM_REASM_SLOTS; id++) feed(r, 1, id, a, 0, 0);
  std::string b = text(10);
  TEST_ASSERT_NOT_NULL(feed(r, 5, 1, b, 0, PM_REASM_TIMEOUT_MS + 1));
}

static void test_bad_chunks_ignored() {
  PmReassembly r;
  uint8_t d[PM_API_CHUNK] = {};
  TEST_ASSERT_NULL(r.add(1, 1, 3, 2, d, 10, 0));                 // index past end
  TEST_ASSERT_NULL(r.add(1, 1, 0, 2, d, 10, 0));                 // short non-final chunk
  TEST_ASSERT_NULL(r.add(1, 1, 0, PM_API_MAX_CHUNKS + 1, d, PM_API_CHUNK, 0));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_chunk_count);
  RUN_TEST(test_single_chunk);
  RUN_TEST(test_out_of_order_with_duplicates);
  RUN_TEST(test_interleaved_sources);
  RUN_TEST(test_abandoned_message_times_out);
  RUN_TEST(test_bad_chunks_ignored);
  return UNITY_END();
}
