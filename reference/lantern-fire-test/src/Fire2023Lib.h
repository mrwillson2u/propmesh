// src/Fire2023Lib.h

#ifndef FIRE2023LIB_H
#define FIRE2023LIB_H

#include <Arduino.h>
#include <FastLED.h>
#include <memory.h> 

class Fire2023Lib {
public:
    // User must now create the controller externally for SPI chipsets.
    // The library only needs the dimensions.
    Fire2023Lib(uint8_t width, uint8_t height);
    
    // We provide a dedicated setup function for the LED array and initial heat map.
    // The user will pass the CRGB array that FastLED is controlling.
    void begin(CRGB* ledArray);

    ~Fire2023Lib(); 

    void update(uint32_t now);
    
    // The original pin configuration members are removed as they caused template issues.
    // The library now relies on the user to handle the FastLED.addLeds<CHIPSET, DATA, CLOCK, ORDER>(leds, NUM).

private:
    // ** Fire Parameters (Corrected to const members) **
    const uint8_t BRIGHTNESS = 255;
    const uint8_t FIRESPEED = 2;
    const float FLAMEHEIGHT = 3; 
    const uint8_t FIRENOISESCALE = 0; 
    const uint8_t SMOKESPEED = 25; 
    const uint8_t SMOKENOISE_DIMMER = 250; 
    const uint8_t SMOKENOISESCALE = 125; 

    // ** Matrix Configuration **
    const uint8_t WIDTH;
    const uint8_t HEIGHT;
    const uint16_t NUM_LEDS;
    const uint8_t LAST_VISIBLE_LED;
    const uint8_t CentreX;
    const uint8_t CentreY;

    CRGB* leds; // Pointer to the user-provided LED array
    
    // ** Internal data structures **
    const uint8_t NUM_LAYERS = 2;
    const uint8_t FIRENOISE = 0;
    const uint8_t SMOKENOISE = 1;
    
    uint8_t* noise; 
    uint8_t* heat;  
    
    // XYTable is still fixed, we'll address this later.
    const uint8_t XYTable[8] = { 3, 4, 2, 5, 1, 6, 0, 7 }; 
    uint8_t XY(uint8_t x, uint8_t y);

    uint16_t getNoiseIndex(uint8_t layer, uint8_t x, uint8_t y) const {
        return (uint16_t)(layer * WIDTH * HEIGHT) + (x * HEIGHT) + y;
    }

    // Perlin noise state
    uint32_t x[2]; // Use fixed size since NUM_LAYERS is constant
    uint32_t y[2]; 
    uint32_t z[2];
    uint32_t scale_x[2];
    uint32_t scale_y[2];

    CRGBPalette32 hotPalette;
    void initPalette();
};

#endif