import json,re,sys,zipfile
cat=json.load(open(sys.argv[1]))
for job in sys.argv[2:]:
    d=json.load(open(f'{job}/design.json')); z=zipfile.ZipFile(f'{job}/firmware.zip')
    names=z.namelist(); pinsn=[n for n in names if n.endswith('pins.h')][0]
    pins={m.group(1):int(m.group(2)) for m in re.finditer(r'PIN_(\w+) = (\d+)',z.read(pinsn).decode())}
    parts={p['id']:p for p in d['parts']}
    bymod={p['module']:p['id'] for p in d['parts']}
    nets={}
    for n in d['nets']:
        for e in n['endpoints']: nets[(e['part'],e['pin'])]=n
    def gpio_of(net):
        g=[e['pin'] for e in net['endpoints'] if e['part']=='U1' and e['pin'].startswith('GPIO')]
        assert len(g)==1,net; return int(g[0][4:])
    expected={}
    t=d['template']
    if 'ssd1306-oled-128x64-i2c' in bymod or 'bme280-i2c-4pin' in bymod:
        bus=bymod.get('ssd1306-oled-128x64-i2c') or bymod['bme280-i2c-4pin']
        expected['I2C_SDA']=gpio_of(nets[(bus,'SDA')]);expected['I2C_SCL']=gpio_of(nets[(bus,'SCL')])
    if 'piezo-passive-12mm' in bymod: expected['BUZZER']=gpio_of(nets[(bymod['piezo-passive-12mm'],'+')])
    if t=='focus-timer':
        s=bymod['ky040-rotary-encoder']; expected.update(ENCODER_A=gpio_of(nets[(s,'CLK')]),ENCODER_B=gpio_of(nets[(s,'DT')]),ENCODER_SW=gpio_of(nets[(s,'SW')]))
    if t=='light-lamp':
        expected['LIGHT_SENSE']=gpio_of(nets[('LDR1','2')])
        # D1.A -> R2 -> other side
        an=nets[('D1','A')]; r=[e for e in an['endpoints'] if e['part']!='D1'][0]
        other='2' if r['pin']=='1' else '1'; expected['LED']=gpio_of(nets[(r['part'],other)])
    if 'ds18b20-to92' in bymod: expected['ONEWIRE']=gpio_of(nets[(bymod['ds18b20-to92'],'DQ')])
    print(t,job[-36:-28],'MATCH' if expected==pins else 'DIFF',pins,'' if expected==pins else expected)
    caps={p['id']:p for p in cat['esp32-devkitc-v4']['pins']}
    for k,v in pins.items():
        c=caps[f'GPIO{v}']['gpio']; print(f'    {k}=GPIO{v} out={c["output"]} adc1={c["adc1"]} reserved={c.get("reserved")}')
    b=json.load(z.open(pinsn) if False else open(f'{job}/firmware-build.json'))
    print('    compile',b['status'],b['flash'],b['ram'],b['physicalFlash'])
