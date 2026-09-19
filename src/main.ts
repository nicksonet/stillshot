import { Game } from './game';

async function boot(): Promise<void> {
  // ?emu turns on a software Quest 3 (IWER) so VR can be tested without a headset.
  if (new URLSearchParams(location.search).has('emu')) {
    const { installEmulator } = await import('./emulator');
    await installEmulator();
  }
  const game = new Game(document.getElementById('app')!);
  (window as unknown as { __game: unknown }).__game = game.debugApi();
}

void boot();
