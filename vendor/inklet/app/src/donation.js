import { createElement, HeartHandshake, X } from 'lucide';
import qrUrl from '../../assets/donation/qr.png';

export function mountDonation() {
  const host = document.querySelector('.header-actions');
  if (!host || document.querySelector('#donation-dialog')) return;
  const edition = document.querySelector('.about-product span');
  if (edition) edition.textContent += ' · 打赏版';
  const history = document.querySelector('.release-table tbody');
  if (history) {
    const row = document.createElement('tr');
    for (const [className, text] of [['release-version', '0.11.4'], ['release-summary', '搜索刷新隔离与图表交互同步打赏版'], ['release-date', '2026-10-21']]) {
      const cell = document.createElement('td'); cell.className = className; cell.textContent = text; row.append(cell);
    }
    history.prepend(row);
  }
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'icon-button donation-trigger';
  button.title = '打赏'; button.setAttribute('aria-label', '打赏'); button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'donation-dialog');
  button.append(createElement(HeartHandshake, { width: 17, height: 17, 'stroke-width': 1.7 }));
  const label = document.createElement('span'); label.textContent = '打赏'; button.append(label); host.append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'donation-dialog'; dialog.className = 'donation-dialog'; dialog.setAttribute('aria-labelledby', 'donation-title');
  const form = document.createElement('form'); form.method = 'dialog';
  const header = document.createElement('div'); header.className = 'dialog-heading';
  const title = document.createElement('h2'); title.id = 'donation-title'; title.textContent = '支持 Inklet 墨点';
  const close = document.createElement('button'); close.className = 'icon-button'; close.setAttribute('aria-label', '关闭打赏'); close.append(createElement(X, { width: 18, height: 18, 'stroke-width': 1.7 }));
  header.append(title, close);
  const content = document.createElement('div'); content.className = 'donation-content';
  const message = document.createElement('p'); message.className = 'donation-message'; message.textContent = '开发不易，你的打赏是我更新的动力！';
  const image = document.createElement('img'); image.className = 'donation-qr'; image.src = qrUrl; image.alt = '开发者提供的打赏二维码'; image.width = 593; image.height = 534;
  const note = document.createElement('p'); note.className = 'donation-note'; note.textContent = '软件免费使用，打赏完全自愿，不影响任何功能。';
  content.append(message, image, note);
  const footer = document.createElement('div'); footer.className = 'dialog-footer';
  const done = document.createElement('button'); done.className = 'primary-command'; done.textContent = '关闭'; footer.append(done);
  form.append(header, content, footer); dialog.append(form); document.body.append(dialog);
  button.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', () => button.focus());
}
