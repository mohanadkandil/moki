/** Host execution of generated state machines with mocked I/O; not a hardware simulator. */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { firmwareProject } from '../src/firmware/index.js';
import { buildDesign } from '../src/circuit/templates.js';
const root = resolve(process.argv[2] ?? 'docs/engineering/2026-11-04-tscircuit/evidence/eng_fw/behavior');
await mkdir(root, { recursive: true });
const mock = `
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
using std::isfinite;
#define HIGH 1
#define LOW 0
#define INPUT 0
#define INPUT_PULLUP 2
#define ADC_11db 3
#define SSD1306_SWITCHCAPVCC 2
#define SSD1306_WHITE 1
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
uint32_t fakeNow=0;
int fakePins[40]={};
int fakeADC=0;
uint32_t fakeDuty[16]={};
uint32_t fakeTone[16]={};
float fakeTemperature=25;
std::string fakeScreen;
uint32_t millis() {return fakeNow;}
void delay(int) {}
void pinMode(int pin,int mode) {if(mode==INPUT_PULLUP) fakePins[pin]=HIGH;}
int digitalRead(int pin) {return fakePins[pin];}
int analogRead(int) {return fakeADC;}
void analogReadResolution(int) {}
void analogSetPinAttenuation(int,int) {}
void ledcSetup(int,int,int) {}
void ledcAttachPin(int,int) {}
void ledcWrite(int channel,uint32_t duty) {fakeDuty[channel]=duty;}
void ledcWriteTone(int channel,uint32_t hz) {fakeTone[channel]=hz;}
struct SerialMock {
 void begin(int) {}
 void println(const char*) {}
 template<class... T> void printf(const char*,T...) {}
} Serial;
struct WireMock {void begin(int,int) {}} Wire;
struct Adafruit_SSD1306 {
 int size=1;
 Adafruit_SSD1306(int,int,WireMock*,int) {}
 bool begin(int,int) {return true;}
 void clearDisplay() {}
 void setTextColor(int) {}
 void setTextSize(int s) {size=s;}
 void setCursor(int,int) {}
 void println(const char* s) {if(size==2) fakeScreen=s;}
 void display() {}
};
struct Adafruit_BME280 {bool begin(int,WireMock*) {return true;} float readTemperature() {return fakeTemperature;}};
struct OneWire {OneWire(int) {}};
struct DallasTemperature {
 DallasTemperature(OneWire*) {}
 void begin() {}
 int getDeviceCount() {return 1;}
 void setResolution(int) {}
 void setWaitForConversion(bool) {}
 void requestTemperatures() {}
 float getTempCByIndex(int) {return fakeTemperature;}
};
`;
const harnesses = {
 'focus-timer': `
int main() {
 setup();
 auto step=[](uint32_t ms) {fakeNow+=ms;loop();};
 auto push=[&](bool down) {fakePins[PIN_ENCODER_SW]=down?LOW:HIGH;step(1);step(31);};
 assert(remainingMs==25*60000UL);
 push(true);assert(running);step(1000);assert(remainingMs==25*60000UL-1000);
 push(false);push(true);assert(!running);uint32_t paused=remainingMs;step(5000);assert(remainingMs==paused);
 // Four quadrature transitions, one detent, changes the configured duration once.
 const int positions[]={1,0,2,3};
 for(int position:positions) {fakePins[PIN_ENCODER_A]=(position>>1)&1;fakePins[PIN_ENCODER_B]=position&1;step(1);}
 assert(configuredMinutes==24 || configuredMinutes==26);
 assert(remainingMs==configuredMinutes*60000UL);
 push(false);push(true);assert(running);
 remainingMs=100;step(100);assert(!running && remainingMs==0 && chiming);
 assert(fakeTone[BUZZER_CHANNEL]>0);step(650);assert(!chiming && fakeTone[BUZZER_CHANNEL]==0);
 assert(fakeScreen=="00:00");
 return 0;
}`,
 'light-lamp': `
int main() {
 setup();
 auto sample=[](int adc) {fakeADC=adc;for(int i=0;i<50;i++){fakeNow+=20;loop();}};
 sample(1000);assert(lampOn && fakeDuty[LED_CHANNEL]>0);
 sample(1310);assert(lampOn); // 32%, inside the 30..35 hysteresis dead band
 sample(1800);assert(!lampOn && fakeDuty[LED_CHANNEL]==0);
 sample(1310);assert(!lampOn); // dead band retains the off state too
 sample(0);assert(lampOn && fakeDuty[LED_CHANNEL]>=254); // filtered reading approaches zero
 return 0;
}`,
 'temp-monitor': `
int main() {
 setup();
 auto sample=[](float temperature) {fakeTemperature=temperature;fakeNow+=1000;loop();};
 sample(25);assert(!alertActive && fakeScreen=="25.0 C");
 sample(29);assert(alertActive && chiming);
 sample(27.8f);assert(alertActive); // retain within 0.5 C hysteresis
 sample(27.0f);assert(!alertActive && !chiming);
 sample(30);assert(alertActive);
 sample(NAN);assert(!alertActive && !chiming && fakeScreen=="--");
 return 0;
}`,
};
const results = [];
for (const [name, template, sensor] of [
 ['focus-timer', 'focus-timer', 'ds18b20'], ['light-lamp', 'light-lamp', 'ds18b20'],
 ['temp-monitor', 'temp-monitor', 'ds18b20'], ['temp-monitor-bme280', 'temp-monitor', 'bme280'],
] as const) {
 const project = firmwareProject(buildDesign({template,chosenBy:'user',notes:[],recognized:[],options:{buzzer:true,display:true,sensor,pins:{},alertC:28,alertDirection:'above'}}));
 const cpp = project['src/main.cpp']!.replace(/^#include .+$/gm, '');
 const file = join(root, `${name}.cpp`), executable = join(root, name);
 await writeFile(file, mock + project['include/pins.h']!.replace('#pragma once', '') + cpp + harnesses[template]);
 execFileSync('g++', ['-std=c++17', file, '-o', executable]);
 execFileSync(executable);
 results.push({template:name,status:'pass',scope:'Generated C++ state machine executed on host with mocked GPIO/ADC/sensor/time/display/LEDC; no hardware verification'});
}
await writeFile(join(root, 'results.json'), JSON.stringify({ compiler: execFileSync('g++',['--version'],{encoding:'utf8'}).split('\n')[0], results },null,2)+'\n');
console.log(JSON.stringify(results,null,2));
