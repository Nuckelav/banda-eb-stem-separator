(function () {
  var KEY = 'banda-eb-theme', root = document.documentElement;
  var saved; try { saved = localStorage.getItem(KEY); } catch (e) {}
  root.setAttribute('data-theme', saved || 'dark');
  document.addEventListener('DOMContentLoaded', function () {
    var host = document.querySelector('.env') || document.querySelector('.nav') || document.querySelector('.top');
    if (!host) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ghost themebtn';
    var label = function () { b.textContent = root.getAttribute('data-theme') === 'light' ? 'Tema escuro' : 'Tema claro'; };
    b.addEventListener('click', function () {
      var t = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', t); try { localStorage.setItem(KEY, t); } catch (e) {}
      label(); window.dispatchEvent(new Event('themechange'));
    });
    label(); host.appendChild(b);
  });
})();
