// src/Fire2023Lib.cpp

#include "Fire2023Lib.h"
#include <memory.h> 

// Define the gradient palette (unchanged)
DEFINE_GRADIENT_PALETTE(hot_gp) {
    27, 0, 0, 0,
    28, 140, 40, 0,
    30, 205, 80, 0,
    155, 255, 100, 0,
    210, 255, 200, 0,
    255, 255, 255, 255
};

// Constructor implementation
Fire2023Lib::Fire2023Lib(uint8_t width, uint8_t height)
    : WIDTH(width), HEIGHT(height), 
      NUM_LEDS(width * height), LAST_VISIBLE_LED(width * height - 1),
      CentreX((width / 2)), CentreY((height / 2))
{
    // Dynamically allocate memory for internal state arrays
    // leds is NOT allocated here, it is assigned in begin()
    heat = new uint8_t[NUM_LEDS];
    noise = new uint8_t[NUM_LAYERS * NUM_LEDS]; 
    initPalette(); 
}

// Destructor (unchanged)
Fire2023Lib::~Fire2023Lib() {
    delete[] heat;
    delete[] noise;
    // We do NOT delete[] leds, as the user passed the pointer to us.
}

// Implement the setup (begin) - simplified
void Fire2023Lib::begin(CRGB* ledArray) {
    leds = ledArray;
    FastLED.setBrightness(BRIGHTNESS);
    FastLED.setDither(DISABLE_DITHER);

    // Initialise heat to 0
    memset(heat, 0, NUM_LEDS);
}

// Implement the XY mapping (unchanged, still fixed size)
uint8_t Fire2023Lib::XY(uint8_t x, uint8_t y) {
    if ((x >= WIDTH) || (y >= HEIGHT)) {
        return (LAST_VISIBLE_LED + 1);
    }
    uint8_t i = (y * WIDTH) + x;
    return XYTable[i]; 
}

// Your Fire2023 logic - **Critical variable scoping fix**
void Fire2023Lib::update(uint32_t now) {
    // FIX 2: Define transient variables inside update()
    uint16_t ctrl1 = inoise16(11 * now, 0, 0);
    uint16_t ctrl2 = inoise16(13 * now, 100000, 100000);
    uint16_t ctrl = ((ctrl1 + ctrl2) >> 1);

    // --- (Noise Calculation) ---
    for (uint8_t layer = 0; layer < NUM_LAYERS; layer++) {
        // FIX 2: Use class members for constants
        uint32_t current_x = 3 * ctrl * (layer == FIRENOISE ? FIRESPEED : SMOKESPEED);
        uint32_t current_y = 20 * now * (layer == FIRENOISE ? FIRESPEED : SMOKESPEED);
        uint32_t current_z = 5 * now * (layer == FIRENOISE ? FIRESPEED : SMOKESPEED);
        uint8_t noise_scale = (layer == FIRENOISE ? FIRENOISESCALE : SMOKENOISESCALE);
        
        scale_x[layer] = scale8(ctrl1, noise_scale);
        scale_y[layer] = scale8(ctrl2, noise_scale);

        for (uint8_t x_count = 0; x_count < WIDTH; x_count++) {
            uint32_t xoffset = scale_x[layer] * (x_count - CentreX);
            for (uint8_t y_count = 0; y_count < HEIGHT; y_count++) {
                uint32_t yoffset = scale_y[layer] * (y_count - CentreY);
                uint16_t data = ((inoise16(current_x + xoffset, current_y + yoffset, current_z)) + 1);
                
                uint16_t index = getNoiseIndex(layer, x_count, y_count);

                if (layer == FIRENOISE) {
                    noise[index] = data >> 8;
                } else { // SMOKENOISE
                    noise[index] = data / SMOKENOISE_DIMMER;
                }
            }
        }
    }

    // --- (Heat Propagation, Seed Fire, Color Mapping - Unchanged Logic) ---
    for (uint8_t y_idx = 0; y_idx < HEIGHT - 1; y_idx++) {
        for (uint8_t x_idx = 0; x_idx < WIDTH; x_idx++) {
            heat[XY(x_idx, y_idx)] = heat[XY(x_idx, y_idx + 1)];
        }
    }

    for (uint8_t x_idx = 0; x_idx < WIDTH; x_idx++) {
        uint16_t noise_idx = getNoiseIndex(FIRENOISE, x_idx, CentreY); 
        heat[XY(x_idx, HEIGHT - 1)] = noise[noise_idx]; 
    }

    for (uint8_t y_idx = 0; y_idx < HEIGHT; y_idx++) {
        for (uint8_t x_idx = 0; x_idx < WIDTH; x_idx++) {
            uint16_t fire_noise_idx = getNoiseIndex(FIRENOISE, x_idx, y_idx);
            uint16_t smoke_noise_idx = getNoiseIndex(SMOKENOISE, x_idx, y_idx);
            
            uint8_t dim = noise[fire_noise_idx];
            
            dim = (uint8_t)(dim / FLAMEHEIGHT); 
            dim = 255 - dim;
            
            uint8_t led_index = XY(x_idx, y_idx);
            
            heat[led_index] = scale8(heat[led_index], dim);

            leds[led_index] = ColorFromPalette(hotPalette, heat[led_index], heat[led_index], LINEARBLEND);

            leds[led_index].nscale8(noise[smoke_noise_idx]);
        }
    }
}
void Fire2023Lib::initPalette() {
    hotPalette = hot_gp;
}
