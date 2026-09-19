/**
 * Fullscreen Manager
 * Supports native Fullscreen API (PC, Android Chrome) and Virtual App Fullscreen (iPhone / iOS Safari, WebViews)
 * ensuring mobile players can always enter and exit fullscreen without issues.
 */

let isVirtualFullscreen = false;
let updateUICallback = null;

export function isMobileDevice() {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );
}

export function isFullscreen() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    isVirtualFullscreen
  );
}

export async function requestFullscreen() {
  const elem = document.documentElement;
  let nativeSucceeded = false;

  // 1. Try Native Fullscreen API (Android Chrome, PC, Mac, tablets)
  try {
    if (elem.requestFullscreen) {
      await elem.requestFullscreen();
      nativeSucceeded = true;
    } else if (elem.webkitRequestFullscreen) {
      await elem.webkitRequestFullscreen();
      nativeSucceeded = true;
    } else if (elem.mozRequestFullScreen) {
      await elem.mozRequestFullScreen();
      nativeSucceeded = true;
    } else if (elem.msRequestFullscreen) {
      await elem.msRequestFullscreen();
      nativeSucceeded = true;
    }
  } catch (err) {
    console.warn('Native requestFullscreen failed or not permitted, applying virtual fullscreen fallback:', err);
  }

  // 2. Always apply mobile virtual fullscreen fallback (vital for iPhone / iOS Safari and webviews)
  isVirtualFullscreen = true;
  document.documentElement.classList.add('mobile-fullscreen');
  document.body.classList.add('mobile-fullscreen');

  // Collapse mobile browser navigation chrome if possible
  try {
    window.scrollTo(0, 1);
    setTimeout(() => window.scrollTo(0, 0), 50);
  } catch (e) {
    // Ignore
  }

  // 3. Try Landscape orientation lock for phone FPS
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {
    // Unsupported or permission denied
  }

  if (typeof updateUICallback === 'function') {
    updateUICallback();
  }
}

export async function exitFullscreen() {
  // 1. Exit native fullscreen if active
  try {
    if (document.exitFullscreen && document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen && document.webkitFullscreenElement) {
      await document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen && document.mozFullScreenElement) {
      await document.mozCancelFullScreen();
    } else if (document.msExitFullscreen && document.msFullscreenElement) {
      await document.msExitFullscreen();
    }
  } catch (err) {
    console.warn('Native exitFullscreen error:', err);
  }

  // 2. Clear virtual fullscreen
  isVirtualFullscreen = false;
  document.documentElement.classList.remove('mobile-fullscreen');
  document.body.classList.remove('mobile-fullscreen');

  // 3. Unlock orientation
  try {
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  } catch (e) {
    // Ignore
  }

  if (typeof updateUICallback === 'function') {
    updateUICallback();
  }
}

export async function toggleFullscreen() {
  if (isFullscreen()) {
    await exitFullscreen();
  } else {
    await requestFullscreen();
  }
}

export function initFullscreenUI(onResizeCallback) {
  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (!btnFullscreen) return;

  const iconEnter = btnFullscreen.querySelector('.icon-enter-fullscreen');
  const iconExit = btnFullscreen.querySelector('.icon-exit-fullscreen');
  const label = btnFullscreen.querySelector('.fullscreen-label');

  function updateUI() {
    const active = isFullscreen();
    if (iconEnter && iconExit) {
      if (active) {
        iconEnter.classList.add('hidden');
        iconExit.classList.remove('hidden');
      } else {
        iconEnter.classList.remove('hidden');
        iconExit.classList.add('hidden');
      }
    }
    if (label) {
      label.textContent = active ? 'Exit' : 'Fullscreen';
    }
    btnFullscreen.setAttribute(
      'aria-label',
      active ? 'Exit Fullscreen' : 'Enter Fullscreen'
    );
    btnFullscreen.title = active ? 'Exit Fullscreen' : 'Enter Fullscreen';

    // Notify caller with stepped delays so phone screen transitions properly adjust
    triggerMultiStepResize();
  }

  updateUICallback = updateUI;

  function triggerMultiStepResize() {
    if (typeof onResizeCallback === 'function') {
      onResizeCallback();
      setTimeout(onResizeCallback, 50);
      setTimeout(onResizeCallback, 150);
      setTimeout(onResizeCallback, 300);
      setTimeout(onResizeCallback, 500);
    }
  }

  // Handle click and touch
  let lastToggleTime = 0;
  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - lastToggleTime < 350) return; // Prevent double trigger
    lastToggleTime = now;
    toggleFullscreen();
  };

  btnFullscreen.addEventListener('click', handleToggle);
  btnFullscreen.addEventListener('touchend', handleToggle, { passive: false });

  // Sync state on native fullscreen change (including ESC key or phone back gestures)
  const fullscreenEvents = [
    'fullscreenchange',
    'webkitfullscreenchange',
    'mozfullscreenchange',
    'MSFullscreenChange'
  ];
  fullscreenEvents.forEach((evt) => {
    document.addEventListener(evt, () => {
      const nativeActive = Boolean(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      if (!nativeActive && !isVirtualFullscreen) {
        document.documentElement.classList.remove('mobile-fullscreen');
        document.body.classList.remove('mobile-fullscreen');
      }
      updateUI();
    });
  });

  window.addEventListener('orientationchange', () => {
    triggerMultiStepResize();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      triggerMultiStepResize();
    });
  }

  // Initial state check
  updateUI();

  return {
    updateUI,
    triggerMultiStepResize
  };
}
