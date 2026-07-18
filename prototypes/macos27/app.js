(() => {
  const desktop = document.querySelector('#desktop');
  const windows = [...document.querySelectorAll('[data-window]')];
  const menuPopover = document.querySelector('#menuPopover');
  const contextMenu = document.querySelector('#contextMenu');
  const spotlight = document.querySelector('#spotlight');
  const spotlightInput = document.querySelector('#spotlightInput');
  const spotlightResults = document.querySelector('#spotlightResults');
  const controlCenter = document.querySelector('#controlCenter');
  let topZ = 30;

  const appMeta = {
    finder: ['▰', 'Finder', '查看文件和最近使用的项目'],
    safari: ['◉', 'Safari', '浏览这个独立的 macOS 复刻页面'],
    messages: ['●', '信息', '继续最近的对话'],
    calendar: ['17', '日历', '查看今天的日程'],
    settings: ['⚙', '系统设置', '管理 Wi-Fi、显示器与墙纸'],
  };

  const menuItems = {
    apple: ['关于本机', '系统设置…', 'App Store…', '睡眠', '重新启动…', '关机…'],
    finder: ['关于 Finder', '设置…', '清倒废纸篓…', '服务', '隐藏 Finder'],
    file: ['新建 Finder 窗口', '新建文件夹', '打开', '关闭窗口', '显示简介'],
    edit: ['撤销', '重做', '剪切', '拷贝', '粘贴', '全选'],
    view: ['图标', '列表', '显示边栏', '显示预览', '进入全屏幕'],
    go: ['返回', '前进', '最近使用', '文稿', '下载', '应用程序'],
    window: ['最小化', '缩放', '移动与调整大小', '前置全部窗口'],
    help: ['macOS 帮助', 'Mac 使用提示', '键盘快捷键'],
  };

  function activateWindow(target) {
    windows.forEach((item) => item.classList.remove('active'));
    target.hidden = false;
    target.classList.remove('minimized');
    target.classList.add('active');
    target.style.zIndex = String(++topZ);
    const name = target.dataset.window;
    document.querySelectorAll(`[data-app="${name}"]`).forEach((button) => button.classList.add('running'));
  }

  function openWindow(name) {
    const target = document.querySelector(`[data-window="${name}"]`);
    if (target) activateWindow(target);
    closeTransient();
  }

  function closeTransient(except) {
    if (except !== 'menu') {
      menuPopover.hidden = true;
      document.querySelectorAll('.menu-trigger').forEach((button) => button.classList.remove('active'));
    }
    if (except !== 'control') controlCenter.hidden = true;
    if (except !== 'spotlight') spotlight.hidden = true;
    if (except !== 'context') contextMenu.hidden = true;
  }

  document.querySelectorAll('[data-app],[data-open]').forEach((button) => {
    button.addEventListener('click', () => openWindow(button.dataset.app || button.dataset.open));
  });

  windows.forEach((windowElement) => {
    windowElement.addEventListener('pointerdown', () => activateWindow(windowElement));
    windowElement.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'close') {
          windowElement.hidden = true;
          document.querySelectorAll(`[data-app="${windowElement.dataset.window}"]`).forEach((dockButton) => dockButton.classList.remove('running'));
        } else if (action === 'minimize') {
          windowElement.classList.add('minimized');
        } else {
          windowElement.classList.toggle('fullscreen');
        }
      });
    });
  });

  let drag = null;
  document.querySelectorAll('.drag-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      const target = handle.closest('.mac-window');
      if (target.classList.contains('fullscreen')) return;
      const style = getComputedStyle(target);
      drag = {
        target,
        startX: event.clientX,
        startY: event.clientY,
        x: Number.parseFloat(style.getPropertyValue('--x')) || 0,
        y: Number.parseFloat(style.getPropertyValue('--y')) || 0,
      };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const maxX = Math.max(80, innerWidth / 2 - 180);
      const maxY = Math.max(80, innerHeight / 2 - 120);
      const x = Math.max(-maxX, Math.min(maxX, drag.x + event.clientX - drag.startX));
      const y = Math.max(-maxY, Math.min(maxY, drag.y + event.clientY - drag.startY));
      drag.target.style.setProperty('--x', `${x}px`);
      drag.target.style.setProperty('--y', `${y}px`);
    });
    handle.addEventListener('pointerup', () => { drag = null; });
  });

  document.querySelectorAll('.menu-trigger').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const alreadyOpen = button.classList.contains('active') && !menuPopover.hidden;
      closeTransient('menu');
      if (alreadyOpen) {
        menuPopover.hidden = true;
        button.classList.remove('active');
        return;
      }
      document.querySelectorAll('.menu-trigger').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      menuPopover.replaceChildren(...menuItems[button.dataset.menu].map((label) => {
        const item = document.createElement('button');
        item.textContent = label;
        item.addEventListener('click', () => closeTransient());
        return item;
      }));
      const rect = button.getBoundingClientRect();
      menuPopover.style.left = `${rect.left}px`;
      menuPopover.style.top = '30px';
      menuPopover.hidden = false;
    });
  });

  function renderSpotlight(query = '') {
    const normalized = query.trim().toLowerCase();
    const matches = Object.entries(appMeta).filter(([, data]) => !normalized || data.join(' ').toLowerCase().includes(normalized));
    spotlightResults.className = 'spotlight-results';
    spotlightResults.replaceChildren(...matches.map(([id, [icon, name, description]]) => {
      const button = document.createElement('button');
      button.innerHTML = `<i>${icon}</i><span><b>${name}</b><small>${description}</small></span><b>›</b>`;
      button.addEventListener('click', () => openWindow(id));
      return button;
    }));
  }

  function openSpotlight() {
    closeTransient('spotlight');
    renderSpotlight();
    spotlight.hidden = false;
    requestAnimationFrame(() => spotlightInput.focus());
  }

  document.querySelector('#spotlightTrigger').addEventListener('click', (event) => { event.stopPropagation(); openSpotlight(); });
  document.querySelector('#addressButton').addEventListener('click', openSpotlight);
  document.querySelector('#exploreButton').addEventListener('click', openSpotlight);
  spotlightInput.addEventListener('input', () => renderSpotlight(spotlightInput.value));
  spotlight.addEventListener('pointerdown', (event) => { if (event.target === spotlight) closeTransient(); });
  document.querySelector('.spotlight').addEventListener('pointerdown', (event) => event.stopPropagation());

  document.querySelector('#controlTrigger').addEventListener('click', (event) => {
    event.stopPropagation();
    const next = controlCenter.hidden;
    closeTransient(next ? 'control' : undefined);
    controlCenter.hidden = !next;
  });
  controlCenter.addEventListener('pointerdown', (event) => event.stopPropagation());
  controlCenter.querySelector('.panel-close').addEventListener('click', () => { controlCenter.hidden = true; });

  desktop.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    closeTransient('context');
    contextMenu.style.left = `${Math.min(event.clientX, innerWidth - 225)}px`;
    contextMenu.style.top = `${Math.min(event.clientY, innerHeight - 145)}px`;
    contextMenu.hidden = false;
  });
  contextMenu.addEventListener('pointerdown', (event) => event.stopPropagation());
  contextMenu.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { contextMenu.hidden = true; }));
  desktop.addEventListener('pointerdown', (event) => { if (!event.target.closest('.menu-bar,.dock,.control-center,.spotlight,.context-menu')) closeTransient(); });

  document.querySelectorAll('.play-toggle,.music-dock').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.play-toggle').forEach((toggle) => { toggle.textContent = toggle.textContent === 'Ⅱ' ? '▶' : 'Ⅱ'; });
  }));

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSpotlight();
    }
    if (event.key === 'Escape') closeTransient();
  });

  function updateClock() {
    const now = new Date();
    document.querySelector('#menuClock').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(now);
    document.querySelector('#weekday').textContent = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now);
    document.querySelector('#dayNumber').textContent = String(now.getDate());
  }

  const days = document.querySelector('#calendarDays');
  for (let index = -2; index < 33; index += 1) {
    const button = document.createElement('button');
    const number = index <= 0 ? 30 + index : index > 31 ? index - 31 : index;
    button.textContent = String(number);
    if (index <= 0 || index > 31) button.classList.add('muted');
    if (index === new Date().getDate()) button.classList.add('today');
    days.append(button);
  }

  updateClock();
  renderSpotlight();
  setInterval(updateClock, 30_000);
})();
