#include <Arduino.h>
#include <OSCMessage.h>
#include <OSCBundle.h>
#include <OSCData.h>
#include "painlessMesh.h"

#define   MESH_PREFIX     "lightMesh"
#define   MESH_PASSWORD   "CHANGE-ME"
#define   MESH_PORT       5555

painlessMesh  mesh;

long timer = 0;

// put function declarations here:
int incomingByte = 0; // for incoming serial data
// const int BUILTIN_LED = 13;
unsigned int ledState = LOW;              // LOW means led is *on*
unsigned int ledIntensity = 0;
OSCErrorCode error;

void receiveBytes();

byte nibble(byte val);
void shex(char* store, byte* from, byte len);

void sendMeshBroadcast(String msg) {
  // char msg[] = "Hello from node ";
  mesh.sendBroadcast( msg );
}

// Needed for painless library
void receivedCallback( uint32_t from, String &msg ) {
  Serial.printf("startHere: Received from %u msg=%s\n", from, msg.c_str());
}

void newConnectionCallback(uint32_t nodeId) {
    Serial.printf("--> startHere: New Connection, nodeId = %u\n", nodeId);
}

void changedConnectionCallback() {
  Serial.printf("Changed connections\n");
}

void nodeTimeAdjustedCallback(int32_t offset) {
    Serial.printf("Adjusted time %u. Offset = %d\n", mesh.getNodeTime(),offset);
}

void setup() {
  pinMode(BUILTIN_LED, OUTPUT);
  digitalWrite(BUILTIN_LED, ledState);    // turn *on* led
  // analogWrite(BUILTIN_LED, ledIntensity);

  Serial.begin(115200);
  Serial2.begin(115200, SERIAL_8N1, 16, 17);
  delay(1000);

  // mesh.setDebugMsgTypes( ERROR | MESH_STATUS | CONNECTION | SYNC | COMMUNICATION | GENERAL | MSG_TYPES | REMOTE ); // all types on
  mesh.setDebugMsgTypes( ERROR | STARTUP );  // set before init() so that you can see startup messages

  mesh.init( MESH_PREFIX, MESH_PASSWORD, MESH_PORT );
  mesh.onReceive(&receivedCallback);
  mesh.onNewConnection(&newConnectionCallback);
  mesh.onChangedConnections(&changedConnectionCallback);
  mesh.onNodeTimeAdjusted(&nodeTimeAdjustedCallback);

  Serial.println("Starting BridgeNode");
}

void led(OSCMessage &msg) {
  ledState = msg.getFloat(0);
  digitalWrite(BUILTIN_LED, ledState);
  // analogWrite(BUILTIN_LED, 255);
  
  // ledIntensity = 255;
  // analogWrite(BUILTIN_LED, ledIntensity);
  // timer = millis();
  // Serial.print("/led: ");
  // Serial.println(ledState);
}

void ledCtlr(OSCMessage &msg) {
  int controlerAddress = msg.getFloat(0);
  // float redVal = 

  Serial.print("/ctlr: ");
  Serial.println(controlerAddress);
}


void loop() {
  // if(millis() > timer+100) {
  //   digitalWrite(BUILTIN_LED, LOW);
  //   // if(ledIntensity > 0) {
  //   //   ledIntensity--;
  //   //   analogWrite(BUILTIN_LED, ledIntensity);
  //     // timer = millis();
  //   // }
  // }
  // Serial.println(ledIntensity);

  OSCMessage msg;
  int size = Serial2.available();
  byte packet[size];
  if (size > 0) {
    int packetIndex = 0;
    for(int i = 0; i < size; i++) {
      int nextByte = Serial2.read();
      packet[packetIndex] = nextByte;
      
      // Serial.print((char) nextByte);
      packetIndex++;
    }
    msg.fill(packet, size);
    if (!msg.hasError()) {
      
      
      // for (int i = 0; i < size; i++) {
      //   returnstring[i] = (char) packet[i];
      // }

      // String msgString = String();
      // for(int i = 0; i < size; i++) {
      //   msgString.concat()
      // }
      
    } else {
      error = msg.getError();
      Serial.print("OSCMessate error: ");
      Serial.println(error);
      OSCBundle bundle;
      msg.fill(packet, size);

    }
    // Serial.println();
  }
  mesh.update();

}


void onOSCReceived(&oscData) {
  char charBuff[(size * 2) + 1];
  shex(charBuff, packet, sizeof(packet));
  mesh.sendBroadcast(charBuff);

  oscData.dispatch("/led", led);
  msg.dispatch("/ledCtlr", ledCtlr);

  msg.empty();
}

void receiveBytes() {
  while (Serial2.available() > 0) {
    // read the incoming byte:
    incomingByte = Serial2.read();

    // Serial.println("Available!");
    // say what you got:
    // Serial.print("I received: ");
    // Serial.println(incomingByte);
  }
}

void shex(char* store, byte* from, byte len) {
  while (len--) {
    *store++ = nibble(*from>>4);
    *store++ = nibble(*from++);
  }
  *store = 0;
}
byte nibble(byte val) {
  val &= 0xF;
  return val+(val<10 ? '0' : 'A'-10);
}