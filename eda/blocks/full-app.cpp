#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <driver/i2s.h>
#include "pins.h"
// Compile-validation demo: microphone samples attenuated 18dB to speaker; OLED reports activity.
// Native USB serial, acoustics, I2S clocks, and external modules still require hardware verification.
Adafruit_SSD1306 screen(128,64,&Wire,-1);
static bool audioReady=false, displayReady=false;
static bool startAudio(i2s_port_t port, bool receive){
 i2s_config_t cfg={};cfg.mode=i2s_mode_t(I2S_MODE_MASTER|(receive?I2S_MODE_RX:I2S_MODE_TX));
 cfg.sample_rate=48000;cfg.bits_per_sample=I2S_BITS_PER_SAMPLE_32BIT;cfg.channel_format=I2S_CHANNEL_FMT_ONLY_LEFT;
 cfg.communication_format=I2S_COMM_FORMAT_STAND_I2S;cfg.dma_buf_count=4;cfg.dma_buf_len=64;cfg.use_apll=false;cfg.tx_desc_auto_clear=true;
 if(i2s_driver_install(port,&cfg,0,nullptr)!=ESP_OK)return false;
 i2s_pin_config_t pins={};pins.mck_io_num=I2S_PIN_NO_CHANGE;
 pins.bck_io_num=receive?PIN_MIC_I2S_MIC_BCLK:PIN_AMP_I2S_AMP_BCLK;
 pins.ws_io_num=receive?PIN_MIC_I2S_MIC_WS:PIN_AMP_I2S_AMP_WS;
 pins.data_out_num=receive?I2S_PIN_NO_CHANGE:PIN_AMP_I2S_AMP_SD;
 pins.data_in_num=receive?PIN_MIC_I2S_MIC_SD:I2S_PIN_NO_CHANGE;
 return i2s_set_pin(port,&pins)==ESP_OK;
}
void setup(){
 Serial.begin(115200);pinMode(PIN_LED_LED_DATA,OUTPUT);digitalWrite(PIN_LED_LED_DATA,LOW);
 Wire.begin(PIN_DISPLAY_I2C_DISPLAY_SDA,PIN_DISPLAY_I2C_DISPLAY_SCL);Wire.setClock(100000);
 displayReady=screen.begin(SSD1306_SWITCHCAPVCC,0x3c);
 audioReady=startAudio(I2S_NUM_0,true)&&startAudio(I2S_NUM_1,false);
 if(displayReady){screen.clearDisplay();screen.setTextSize(1);screen.setTextColor(SSD1306_WHITE);screen.setCursor(0,0);screen.println("Moki audio demo");screen.println(audioReady?"Audio initialized":"Audio init failed");screen.display();}
}
void loop(){
 static uint32_t lastDisplay=0;static int32_t samples[128];size_t count=0,sent=0;uint32_t level=0;
 if(audioReady&&i2s_read(I2S_NUM_0,samples,sizeof(samples),&count,20/portTICK_PERIOD_MS)==ESP_OK){
  for(size_t i=0;i<count/sizeof(int32_t);i++){samples[i]/=8;const uint32_t magnitude=samples[i]<0?uint32_t(-int64_t(samples[i])):uint32_t(samples[i]);if(magnitude>level)level=magnitude;}
  if(i2s_write(I2S_NUM_1,samples,count,&sent,20/portTICK_PERIOD_MS)!=ESP_OK||sent!=count)Serial.println("Audio write incomplete");
 }
 if(displayReady&&millis()-lastDisplay>250){lastDisplay=millis();screen.fillRect(0,32,128,32,SSD1306_BLACK);screen.setCursor(0,32);screen.print("Level: ");screen.println(level>>20);screen.display();}
 delay(1);
}
