// Applies the stored theme preference (light | dark | system) before Angular boots, so there is no flash.
(function () {
  var pref = 'system';
  try { var s = localStorage.getItem('fb-theme'); if (s === 'light' || s === 'dark' || s === 'system') pref = s; } catch (e) { /* storage blocked */ }
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var root = document.documentElement;
  root.setAttribute('data-theme', pref === 'system' ? (dark ? 'dark' : 'light') : pref);
  root.setAttribute('data-theme-pref', pref);
})();
