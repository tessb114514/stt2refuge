let clickAudio;
export function playPluginClickSound() {
    try {
        const source = document.getElementById('audio_message_sound');
        if (!source) return;
        // Reuse the Tavern sound without interrupting its message playback.
        if (!clickAudio || clickAudio.src !== source.src) clickAudio = source.cloneNode(false);
        clickAudio.volume = 0.8; clickAudio.pause(); clickAudio.currentTime = 0;
        clickAudio.play()?.catch(() => {});
    } catch { /* Browser audio restrictions must never block a button action. */ }
}
