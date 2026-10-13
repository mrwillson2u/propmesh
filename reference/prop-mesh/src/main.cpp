#include <Arduino.h>
#include "painlessMesh.h"
#include "ArduinoJson.h"
#include <Preferences.h>
// #include "ESPRandom.h"

#define   MESH_PREFIX     "holloween-mesh"
#define   MESH_PASSWORD   "CHANGE-ME"
#define   MESH_PORT       5555

Preferences prefs;
Scheduler userScheduler; // to control your personal task
painlessMesh  mesh;

// User stub
void sendMessage() ; // Prototype so PlatformIO doesn't complain
const char* getUUIDv4();
void receivedCallback( uint32_t from, String &msg );
void newConnectionCallback(uint32_t nodeId);
void changedConnectionCallback();
void nodeTimeAdjustedCallback(int32_t offset);
void loadConfig();



bool ledOn = false;
unsigned long ledOnTime = 0;

bool debugMode = false;

void setup() {
  Serial.begin(115200);
  
  loadConfig();


  //mesh.setDebugMsgTypes( ERROR | MESH_STATUS | CONNECTION | SYNC | COMMUNICATION | GENERAL | MSG_TYPES | REMOTE ); // all types on
  mesh.setDebugMsgTypes( ERROR | STARTUP );  // set before init() so that you can see startup messages

  mesh.init( MESH_PREFIX, MESH_PASSWORD, MESH_PORT, WIFI_AP_STA, 11 );
  mesh.onReceive(&receivedCallback);
  mesh.onNewConnection(&newConnectionCallback);
  mesh.onChangedConnections(&changedConnectionCallback);
  mesh.onNodeTimeAdjusted(&nodeTimeAdjustedCallback);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  // userScheduler.addTask( taskSendMessage );
  // taskSendMessage.enable();

  // Enable OTA with a role of "prop-node" and a callback to track progress
  mesh.initOTAReceive("prop-node");
  // This node and all other nodes should know the mesh contains a root,
  // so they can be sure they're on the same sub-mesh.
  mesh.setContainsRoot(true);

}

void loop() {
  // it will run the user scheduler as well
  mesh.update();

  // if(ledOn && millis() - ledOnTime > 500){
  //   digitalWrite(LED_BUILTIN, LOW);
  //   ledOn = false;
  // }
}


// // Function that returns a const char* UUID v4 string
// const char* generateUUID() {
//   static char uuidStr[37]; // 36 chars + null terminator

//   uint8_t uuid_array[16];
//   ESPRandom::uuid4(uuid_array);

//   String uuidString = ESPRandom::uuidToString(uuid_array);
//   uuidString.toCharArray(uuidStr, sizeof(uuidStr));

//   return uuidStr;
// }

void turnOnLed(){
  digitalWrite(LED_BUILTIN, HIGH);
  ledOnTime = millis();
  ledOn = true;
}

// Needed for painless library
void receivedCallback( uint32_t from, String &msg ) {
  Serial.printf("startHere: Received from %u msg=%s\n", from, msg.c_str());
  // turnOnLed();
  
  // Allocate the JSON document
  JsonDocument doc;

  // Parse JSON object
  DeserializationError error = deserializeJson(doc, msg);
  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    return;
  }


  
  const char* messageId = doc["messageId"];
  const char* type = doc["type"];

  if (messageId) {
    Serial.printf("Message ID: %s\n", messageId);
  }

  if (strcmp(type, "action") == 0) {
    // Serial.println("Action message received");
    const char* state = doc["state"];
    const int pinCount = doc["pins"].size();

    
    for (size_t i = 0; i < pinCount; i++) {
      if (doc["pins"][i].containsKey("gpio") && doc["pins"][i].containsKey("type") && doc["pins"][i].containsKey("state"))
      {
        const int gpio = doc["pins"][i]["gpio"];
        const char* type = doc["pins"][i]["type"];
        if(strcmp(type, "DIGITAL") == 0){
          const char* state = doc["pins"][i]["state"];
          Serial.printf("Setting GPIO %d to state %s\n", gpio, state);
          if (strcmp(state, "HIGH") == 0) {
            digitalWrite(gpio, HIGH);
          } else if (strcmp(state, "LOW") == 0) {
            digitalWrite(gpio, LOW);
          }
        }
        else if (strcmp(type, "ANALOG") == 0)
        {
          const int state = doc["pins"][i]["state"];
          Serial.printf("Setting GPIO %d to analog value %d\n", gpio, state);
          analogWrite(gpio, state);
        }
        
        
      }
      else {
        Serial.println("action message missing gpio, type, or state key");
      }
    }

  } else if (strcmp(type, "config") == 0) {
    Serial.println("Config message received");
    
    prefs.begin("config", false);
    // Save the config to preferences
    prefs.putString("config", msg);
    prefs.end();

    Serial.println("Config saved to preferences:");
    Serial.println(msg);
    loadConfig();

  } else {
    Serial.println("Unknown message type");
  }
}

void loadConfig(){
  prefs.begin("config", false);
  printf("Free entries in prefs: %d\n", prefs.freeEntries());
  if(prefs.isKey("config")){
    JsonDocument doc;
    String config = prefs.getString("config", "");

    Serial.println("Config found in preferences:");
    Serial.println(config);

    // Parse JSON object
    DeserializationError error = deserializeJson(doc, config);
    Serial.println("After deserialization");
    if (error) {
      Serial.print(F("deserializeJson() failed: "));
      Serial.println(error.f_str());
      return;
    }
    Serial.println("After deserialization success");
    const int pinCount = doc["pins"].size();
    Serial.printf("Configuring %d pins\n", pinCount);
    for (size_t i = 0; i < pinCount; i++) {
      if(doc["pins"][i].containsKey("gpio") && doc["pins"][i].containsKey("mode")){
        
        const int gpio = doc["pins"][i]["gpio"];
        const char* mode = doc["pins"][i]["mode"];
        if (strcmp(mode, "OUTPUT") == 0) {
          Serial.println("Setting pin to OUTPUT");
          pinMode(gpio, OUTPUT);
        } else if (strcmp(mode, "INPUT") == 0) {
          Serial.println("Setting pin to INPUT");
          pinMode(gpio, INPUT);
        } else if (strcmp(mode, "INPUT_PULLUP") == 0) {
          Serial.println("Setting pin to INPUT_PULLUP");
          pinMode(gpio, INPUT_PULLUP);
        }
      }
      else {
        Serial.println("config missing gpio or mode key");
      }
      
    }
    Serial.println("Configuration complete.");
  } else {
    Serial.println("No config found in preferences.");
  }
  prefs.end();
  Serial.println("Preferences closed.");
}

void newConnectionCallback(uint32_t nodeId) {
    Serial.printf("--> startHere: New Connection, nodeId = %u\n", nodeId);
    // turnOnLed();
}

void changedConnectionCallback() {
  Serial.printf("Changed connections\n");
  // turnOnLed();
}

void nodeTimeAdjustedCallback(int32_t offset) {
    Serial.printf("Adjusted time %u. Offset = %d\n", mesh.getNodeTime(),offset);
    // turnOnLed();
}