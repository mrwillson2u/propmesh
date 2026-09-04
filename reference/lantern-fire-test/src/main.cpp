// Example: src/main.cpp (The corrected user sketch)

#include <Arduino.h>
#include <FastLED.h>
#include "Fire2023Lib.h" 

// Configuration (REQUIRED for FastLED's template setup)
#define WIDTH  2
#define HEIGHT 4
#define DATA_PIN     20
#define CLOCK_PIN    19
#define LED_TYPE     SK9822
#define COLOR_ORDER  BGR

#define NUM_LEDS (WIDTH * HEIGHT)
CRGB leds[ NUM_LEDS ];

// FIX 1: Create an instance of the fire effect using only 2 arguments (WIDTH, HEIGHT)
Fire2023Lib fire(WIDTH, HEIGHT);

void setup() {
    delay(1000); 

    // Step 1: User handles the template-based FastLED setup
    FastLED.addLeds<LED_TYPE, DATA_PIN, CLOCK_PIN, COLOR_ORDER>(leds, NUM_LEDS);
    
    // Step 2: User passes the initialized LED array to the library's setup
    // FIX 2: Call begin() with one argument (the LED array)
    fire.begin(leds); 
    
    // Optional: Set brightness here as the library has set the default already
    FastLED.setBrightness(128);
}

void loop() {
    EVERY_N_MILLISECONDS(8) {
        fire.update(millis());
    }
    FastLED.show();
}