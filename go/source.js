(function () {
  'use strict';
  if (!window.TAILF) return;
  var store = window.location.pathname.split('/')[2];
  if (store === 'appstore') {
    window.TAILF.appStoreUrl(function (url) {
      if (url) window.location.replace(url);
    });
    return;
  }
  if (store === 'play' && window.TAILF.PLAY_URL) {
    window.location.replace(window.TAILF.PLAY_URL);
    return;
  }
  if (store === 'testflight' && window.TAILF.TESTFLIGHT_URL) {
    window.setTimeout(function () {
      window.location.replace(window.TAILF.TESTFLIGHT_URL);
    }, 800);
  }
})();
