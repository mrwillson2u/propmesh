/**
 * Author Teemu Mäntykallio
 * Initializes the library and runs the stepper
 * motor in alternating directions.
 */

#include <TMCStepper.h>

#include <AccelStepper.h>

#define EN_PIN           18 // Enable
#define DIR_PIN          19 // Direction
#define STEP_PIN         21 // Step
// #define CS_PIN           42 // Chip select
#define UART_RX_PIN      16 // ESP32 RX pin (connect to TMC PDN_UART)
#define UART_TX_PIN      17 // ESP32 TX pin (connect to TMC PDN_UART via 1k resistor)
// #define SW_MOSI          66 // Software Master Out Slave In (MOSI)
// #define SW_MISO          44 // Software Master In Slave Out (MISO)
// #define SW_SCK           64 // Software Slave Clock (SCK)
// #define SW_RX            63 // TMC2208/TMC2224 SoftwareSerial receive pin
// #define SW_TX            40 // TMC2208/TMC2224 SoftwareSerial transmit pin
#define SERIAL_PORT Serial2 // TMC2208/TMC2224 HardwareSerial port
#define DRIVER_ADDRESS 0b00 // TMC2209 Driver address according to MS1 and MS2

#define R_SENSE 0.11f // Match to your driver
                      // SilentStepStick series use 0.11
                      // UltiMachine Einsy and Archim2 boards use 0.2
                      // Panucatt BSD2660 uses 0.1
                      // Watterott TMC5160 uses 0.075

// Select your stepper driver type
//TMC2130Stepper driver(CS_PIN, R_SENSE);                           // Hardware SPI
//TMC2130Stepper driver(CS_PIN, R_SENSE, SW_MOSI, SW_MISO, SW_SCK); // Software SPI
//TMC2660Stepper driver(CS_PIN, R_SENSE);                           // Hardware SPI
//TMC2660Stepper driver(CS_PIN, R_SENSE, SW_MOSI, SW_MISO, SW_SCK);
//TMC5160Stepper driver(CS_PIN, R_SENSE);
//TMC5160Stepper driver(CS_PIN, R_SENSE, SW_MOSI, SW_MISO, SW_SCK);

//TMC2208Stepper driver(&SERIAL_PORT, R_SENSE);                     // Hardware Serial
//TMC2208Stepper driver(SW_RX, SW_TX, R_SENSE);                     // Software serial
TMC2209Stepper driver(&SERIAL_PORT, R_SENSE, DRIVER_ADDRESS);
//TMC2209Stepper driver(SW_RX, SW_TX, R_SENSE, DRIVER_ADDRESS);

AccelStepper stepper = AccelStepper(stepper.DRIVER, STEP_PIN, DIR_PIN);

// --- MOTOR & MOVEMENT CALCULATIONS ---
const uint32_t microsteps = 1;   // *** RECOMMENDED FIX: Use 1/16 for balance ***
const uint32_t stepsPerRev = 200 * microsteps; // 3200 steps/rev at 1/16
// 200 steps/rev * 16 microsteps / 120 mm/rev = 26.666 steps/mm
const float steps_per_mm = (float)stepsPerRev / 120.0f; // *** CORRECTED CALCULATION ***

const bool BACKWARD = false;
const bool FORWARD = true;

struct Delay {
  unsigned long timestamp;
  int delayLength; // In milliseconds

  // Check if delay is still active
  bool isDelayed() {
    return millis() - this->timestamp <= this->delayLength;
  }

  void setDelay(int length) {
    this->delayLength = length;
    this->timestamp = millis();
  }
};

Delay motionDelay;

void setup() {
  pinMode(EN_PIN, OUTPUT);
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);      // Enable driver in hardware
  digitalWrite(DIR_PIN, HIGH);

  Serial.begin(115200);
                                  // Enable one according to your setup
  //SPI.begin();                    // SPI drivers
  SERIAL_PORT.begin(115200);      // HW UART drivers
  // driver.beginSerial(115200);     // SW UART drivers

  driver.begin();                 //  SPI: Init CS pins and possible SW SPI pins
                                  // UART: Init SW UART (if selected) with default 115200 baudrate
  driver.toff(5);                 // Enables driver in software
  driver.rms_current(1420);    //1420    // Set motor RMS current 500*stepsper_mm

  if(microsteps > 1) {
    driver.microsteps(microsteps);          // Set microsteps to (2, 4, 8, 16)
  }
  

  // driver.en_pwm_mode(false);       // Toggle stealthChop on TMC2130/2160/5130/5160
  driver.en_spreadCycle(true);   // Toggle spreadCycle on TMC2208/2209/2224
  
  driver.pwm_autoscale(false);     // Needed for stealthChop

  stepper.setMaxSpeed(20000); // 100mm/s @ 80 steps/mm
  stepper.setAcceleration(2000.0f * steps_per_mm); // Use float calculation
  stepper.setEnablePin(EN_PIN);
  stepper.setPinsInverted(false, false, true);
  stepper.enableOutputs();

  // Serial.print("TMC2209 Current set to: ");
  // Serial.print(driver.getCurrent() * 1000.0 / 1024.0); // Readback is an approximation
  // Serial.println(" mA");

  stepper.setMaxSpeed(500);
  // driver.shaft(BACKWARD);
  // while(stepper.distanceToGo() > 0) {// Add endswitch code 
  //   stepper.enableOutputs();
  //   stepper.move(600*steps_per_mm); // Move 100mm
    
  // }

}

bool shaft = true;
bool animate = false;
int animationStage = 0;
bool goHome = false;

void loop() {


  // Serial.printf("Running animation: %d\n", animationStage);

  if (stepper.distanceToGo() == 0 && !motionDelay.isDelayed()) {
    switch (animationStage) {
      case 0:
        Serial.printf("Running animation: 0\n");
        stepper.setMaxSpeed(200000);
        // driver.shaft(true);
        stepper.setPinsInverted(FORWARD, false, true);
        stepper.move(4000*steps_per_mm);
        animationStage++;
        break;
      case 1:
        Serial.printf("Running animation: 1\n");
        stepper.setMaxSpeed(300000);
        stepper.setPinsInverted(BACKWARD, false, true);
        stepper.move(1800*steps_per_mm);
        animationStage++;
        break;
      case 2:
        Serial.printf("Running animation: 2\n");
        stepper.setMaxSpeed(360000);
        stepper.setPinsInverted(FORWARD, false, true);
        stepper.move(1200*steps_per_mm);
        animationStage++;
        break;
      case 3:
        Serial.printf("Running animation: 3\n");
        stepper.setMaxSpeed(200000);
        stepper.setPinsInverted(BACKWARD, false, true);
        stepper.move(3600*steps_per_mm);
        animationStage++;
        break;
      case 4:
        Serial.printf("Running animation: 4\n");
        motionDelay.setDelay(2000);
        animationStage++;
        break;
      default:
        Serial.printf("Running animation: default\n");
        goHome = true;
        animationStage = 0;
    }
  }

  

  // if (stepper.distanceToGo() == 0) {
  //     // stepper.disableOutputs();
  //     delay(100);
  //     shaft = !shaft;
  //     driver.shaft(shaft);
  //     stepper.move(100*steps_per_mm); // Move 100mm
  //     stepper.enableOutputs();
  // }
  stepper.run();

}





