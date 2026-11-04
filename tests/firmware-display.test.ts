import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firmwareProject } from '../src/firmware/index.js';
import { buildDesign } from '../src/circuit/templates.js';

test('real generated focus firmware skips unchanged OLED frames and polls quick encoder turns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moki-display-host-'));
  try {
    const graph = buildDesign({ template: 'focus-timer', chosenBy: 'user', recognized: [], notes: [], options: { buzzer: false, display: true, sensor: 'ds18b20', pins: {} } });
    const project = firmwareProject(graph);
    const mock = `
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cmath>
using std::isfinite;
#define HIGH 1
#define LOW 0
#define INPUT_PULLUP 2
#define SSD1306_SWITCHCAPVCC 2
#define SSD1306_WHITE 1
#define constrain(x,a,b) ((x)<(a)?(a):((x)>(b)?(b):(x)))
uint32_t nowMs=0; int pins[40]={}; int frames=0;
uint32_t millis(){return nowMs;} void delay(int){}
void pinMode(int p,int){pins[p]=HIGH;} int digitalRead(int p){return pins[p];}
struct {void begin(int){} void println(const char*){}} Serial;
struct WireMock {void begin(int,int){}} Wire;
struct Adafruit_SSD1306 {
  Adafruit_SSD1306(int,int,WireMock*,int){}
  bool begin(int,int){return true;}
  void clearDisplay(){} void setTextColor(int){} void setTextSize(int){} void setCursor(int,int){}
  void println(const char*){} void display(){frames++;}
};
`;
    const harness = `
int main(){
 setup(); loop(); assert(frames==1);
 // Two seconds of fast input polls with unchanged contents require no OLED transfers.
 for(int i=0;i<2000;i++){nowMs++;loop();} assert(frames==1);
 const int positions[]={1,0,2,3};
 for(int p:positions){pins[PIN_ENCODER_A]=(p>>1)&1;pins[PIN_ENCODER_B]=p&1;nowMs++;loop();}
 assert(configuredMinutes==24 || configuredMinutes==26); assert(frames==2);
 for(int i=0;i<500;i++){nowMs++;loop();} assert(frames==2);
 pins[PIN_ENCODER_SW]=LOW; nowMs++;loop();nowMs+=31;loop();assert(running);assert(frames==3);
 for(int i=0;i<500;i++){nowMs++;loop();}assert(frames==3);
 nowMs+=500;loop();assert(frames==4);
 return 0;
}
`;
    const source = join(dir, 'display.cpp'), binary = join(dir, 'display');
    await writeFile(source, mock + project['include/pins.h']!.replace('#pragma once', '') + project['src/main.cpp']!.replace(/^#include.*$/gm, '') + harness);
    execFileSync('g++', ['-std=c++17', source, '-o', binary], { timeout: 20_000, stdio: 'pipe' });
    assert.doesNotThrow(() => execFileSync(binary, [], { timeout: 5000, stdio: 'pipe' }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
