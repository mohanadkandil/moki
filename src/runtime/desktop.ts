import type { Sandbox } from '@daytona/sdk';

/** A desktop driver; the application owns permissions, lifecycle and tool dispatch. */
export class MokiDesktop {
  constructor(private readonly sandbox: Sandbox) {}

  async screenshot() {
    const shot = await this.sandbox.computerUse.screenshot.takeFullScreen();
    if (!shot.screenshot) throw new Error('Desktop provider returned no screenshot');
    return { mimeType: 'image/png' as const, base64: shot.screenshot };
  }

  async click(x: number, y: number) {
    const info = await this.sandbox.computerUse.display.getInfo();
    const display = info.displays?.[0];
    if (!display || display.width === undefined || display.height === undefined || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= display.width || y >= display.height) {
      throw new Error('Click is outside the desktop bounds');
    }
    return this.sandbox.computerUse.mouse.click(x, y);
  }

  async type(text: string) {
    if (text.length > 20_000) throw new Error('Text input exceeds driver limit');
    await this.sandbox.computerUse.keyboard.type(text);
  }

  async hotkey(keys: string) { await this.sandbox.computerUse.keyboard.hotkey(keys); }
}
