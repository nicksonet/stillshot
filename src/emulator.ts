import { XRDevice, metaQuest3 } from 'iwer';

/** Installs an emulated Meta Quest 3 over navigator.xr. Exposed as window.__xrDevice. */
export async function installEmulator(): Promise<void> {
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  device.position.set(0, 1.65, 0);
  (window as unknown as { __xrDevice: XRDevice }).__xrDevice = device;

  // Mouse/keyboard controls for the emulated headset; tests pass ?emu&noui to skip it.
  if (!new URLSearchParams(location.search).has('noui')) {
    const { DevUI } = await import('@iwer/devui');
    device.installDevUI(DevUI);
  }
}
