import type { FileEntry, FileOperation, FileQuestion, FilesSnapshot } from '../../../shared/contracts/files';

/** 创建始终保留 DOM 的文件管理器，列表刷新不改变当前位置。 */
export function createFilePanel(home: () => void) {
  const element = document.createElement('section');
  element.id = 'files-panel';
  element.innerHTML = `<header class="files-header"><button data-home>← 桌面</button><div><strong>文件管理器</strong><small>本机文件 · 自动刷新</small></div><button data-computer>此电脑</button><button data-up>上一级</button><button data-refresh>刷新</button></header><form class="files-address"><label for="files-path">位置</label><input id="files-path" autocomplete="off" placeholder="此电脑"><button>前往</button></form><nav class="files-actions" aria-label="文件操作"><button data-action="mkdir">新建文件夹</button><button data-action="copy">复制</button><button data-action="move">剪切</button><button data-action="paste">粘贴</button><button data-action="rename">重命名</button><button data-action="delete">删除</button></nav><div class="files-body"><aside aria-label="位置入口"></aside><div class="files-list" tabindex="0" aria-label="文件列表"></div></div><footer class="files-footer"><p class="files-status" role="status">正在读取本地磁盘…</p><p class="files-notice">自动展示外部文件变化；文件出现不代表下载完成。</p></footer><div class="files-overlay" hidden><section role="dialog" aria-modal="true" aria-label="文件操作确认"><h2>文件操作</h2><p></p><input aria-label="名称" maxlength="240"><div class="files-choices"></div></section></div>`;
  const list = element.querySelector<HTMLElement>('.files-list')!;
  const sidebar = element.querySelector<HTMLElement>('aside')!;
  const address = element.querySelector<HTMLInputElement>('#files-path')!;
  const status = element.querySelector<HTMLElement>('.files-status')!;
  const overlay = element.querySelector<HTMLElement>('.files-overlay')!;
  const nameInput = overlay.querySelector<HTMLInputElement>('input')!;
  const choices = overlay.querySelector<HTMLElement>('.files-choices')!;
  let current = '', entries:FileEntry[] = [], visible = false, busy = false;
  let selected = new Set<string>();
  let clipboard:{ kind:'copy'|'move'; sources:string[] } | undefined;
  let locations:{name:string;path:string}[] = [], shortcuts:{name:string;path:string}[] = [];
  let dismiss: (() => void) | undefined;
  let previousFocus:HTMLElement|null = null;

  /** 按选择、剪贴板和运行状态更新操作可用性。 */
  function updateActions() {
    for (const button of element.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      const action = button.dataset.action;
      button.disabled = busy || (action === 'mkdir' ? !current : action === 'paste' ? !current || !clipboard : action === 'rename' ? selected.size !== 1 : selected.size === 0);
    }
    element.querySelector<HTMLButtonElement>('[data-up]')!.disabled = !current;
  }
  /** 所有文件名称只写入 textContent，避免磁盘名称被当成 HTML。 */
  function button(text:string, callback:() => void) {
    const control = document.createElement('button'); control.type = 'button'; control.textContent = text;
    control.addEventListener('click',callback); return control;
  }
  /** 常用位置和已发现磁盘独立更新，不强制跳转新插入的 U 盘。 */
  function renderPlaces() {
    sidebar.replaceChildren(button('此电脑', /* 返回磁盘列表。 */ () => { void navigate(''); }));
    for (const place of [...shortcuts,...locations]) sidebar.append(button(place.name, /* 浏览系统提供的位置。 */ () => { void navigate(place.path); }));
  }
  /** 显示文件列表，并恢复滚动、选择和仍存在的控件焦点。 */
  function renderList() {
    const scroll = list.scrollTop;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.file : undefined;
    list.replaceChildren();
    if (!current) {
      for (const location of locations) list.append(button(`▣  ${location.name}`, /* 打开本地磁盘。 */ () => { void navigate(location.path); }));
      if (!locations.length) list.textContent = '暂无可访问的本地磁盘。';
    } else {
      const heading = document.createElement('div'); heading.className = 'file-row file-heading'; heading.textContent = '选择　名称　　　　　　　　　　　　　大小　　　　　修改时间'; list.append(heading);
      for (const entry of entries) {
        const row = document.createElement('div'); row.className = 'file-row';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(entry.path); checkbox.dataset.file = entry.path; checkbox.setAttribute('aria-label',`选择 ${entry.name}`);
        checkbox.addEventListener('change', /* 保留多选，不因实时刷新丢失。 */ () => { if (checkbox.checked) selected.add(entry.path); else selected.delete(entry.path); updateActions(); });
        const name = button(`${entry.kind === 'directory' ? '▸' : entry.kind === 'link' ? '↗' : '·'} ${entry.name}`, /* 浏览目录及可解析的本地链接，不启动外部程序。 */ () => {
          if (entry.kind === 'directory' || entry.kind === 'link') void navigate(entry.path);
          else { selected = new Set([entry.path]); renderList(); updateActions(); }
        });
        name.className = 'file-name'; name.title = entry.name;
        const size = document.createElement('span'); size.textContent = entry.kind === 'directory' ? '文件夹' : entry.kind === 'unavailable' ? '无法读取' : `${entry.size.toLocaleString()} B`;
        const modified = document.createElement('span'); modified.textContent = entry.modified ? new Date(entry.modified).toLocaleString('zh-CN',{ hour12:false }) : '—';
        row.append(checkbox,name,size,modified); list.append(row);
      }
      if (!entries.length) { const empty = document.createElement('p'); empty.textContent = '此文件夹为空。'; list.append(empty); }
    }
    list.scrollTop = scroll;
    if (focused) Array.from(list.querySelectorAll<HTMLInputElement>('input')).find(/* 恢复现存项目的焦点。 */ input => input.dataset.file === focused)?.focus({ preventScroll:true });
  }
  /** 接收新快照，仅目录实际变化时重建列表。 */
  function receive(snapshot:FilesSnapshot) {
    if (!visible) return;
    const before = JSON.stringify({ current,entries,locations });
    if (snapshot.roots) { locations = snapshot.roots; renderPlaces(); }
    if ('directory' in snapshot) {
      current = snapshot.directory?.path ?? ''; entries = snapshot.directory?.entries ?? [];
      selected = new Set([...selected].filter(/* 已删除项目不再保留选择。 */ item => entries.some(/* 按完整路径匹配。 */ entry => entry.path === item)));
      if (document.activeElement !== address) address.value = current;
    }
    if (before !== JSON.stringify({ current,entries,locations })) renderList();
    if (snapshot.error) status.textContent = snapshot.error;
    else if (!busy) status.textContent = current ? `${entries.length} 个项目 · 实时刷新中` : `${locations.length} 个本地磁盘 · 插入 U 盘后自动显示`;
    updateActions();
  }
  /** 切换位置前在主进程验证；错误显示在当前界面。 */
  async function navigate(target:string) {
    if (target !== current) { selected.clear(); list.scrollTop = 0; }
    try { await window.desktop.openFiles(target); }
    catch (failure) { status.textContent = `无法打开：${String(failure)}`; }
  }
  /** 使用受显示校正管理的确认层；不使用系统文件对话框。 */
  function choose(message:string, options:{label:string;value:string}[], initialName?:string):Promise<string> {
    dismiss?.(); previousFocus = document.activeElement as HTMLElement;
    overlay.hidden = false; overlay.querySelector('p')!.textContent = message;
    nameInput.hidden = initialName === undefined; nameInput.value = initialName ?? ''; choices.replaceChildren();
    return new Promise(/* 只有明确点击才授权变更，离开界面即取消。 */ resolve => {
      /** 关闭确认层并恢复触发位置。 */
      function finish(value:string) { overlay.hidden = true; dismiss = undefined; previousFocus?.focus(); resolve(value); }
      dismiss = /* 取消未确认的操作。 */ () => finish('cancel');
      for (const option of options) choices.append(button(option.label, /* 输入与取消信号分开，允许文件名为 cancel。 */ () => finish(option.value === 'name' ? `name:${nameInput.value}` : option.value)));
      if (!nameInput.hidden) { nameInput.focus(); nameInput.select(); } else choices.querySelector('button')?.focus();
    });
  }
  /** 把主进程的单项冲突或删除问题交给用户。 */
  async function question(question:FileQuestion) {
    if (!visible) { window.desktop.answerFileQuestion(question.id,'cancel'); return; }
    const options = question.kind === 'conflict' ? [{label:'覆盖',value:'overwrite'},{label:'跳过',value:'skip'},{label:'保留两份',value:'keep'}] : question.kind === 'delete' ? [{label:'移入回收站',value:'trash'}] : [{label:'永久删除',value:'permanent'}];
    options.push({label:'取消',value:'cancel'});
    window.desktop.answerFileQuestion(question.id,await choose(question.message,options));
  }
  /** 执行操作并保留部分完成信息；失败不自动重试。 */
  async function execute(request:FileOperation) {
    busy = true; updateActions(); status.textContent = '正在处理文件，请勿拔出磁盘…';
    try {
      const result = await window.desktop.fileOperation(request);
      status.textContent = `已完成 ${result.completed.length} 项，跳过 ${result.skipped.length} 项。${result.error ? `失败：${result.error}；已完成部分予以保留，请核对源和目标。` : ''}`;
      if (request.kind === 'move' && !result.error && !result.skipped.length) clipboard = undefined;
    } catch (failure) { status.textContent = `操作失败：${String(failure)}`; }
    finally { busy = false; updateActions(); }
  }
  /** 将工具栏操作转换成窄的主进程请求。 */
  async function action(kind:string) {
    const sources = [...selected];
    if (kind === 'copy' || kind === 'move') { clipboard = { kind,sources }; status.textContent = `已${kind === 'copy' ? '复制' : '剪切'} ${sources.length} 项，请进入目标目录后粘贴。`; updateActions(); return; }
    if (kind === 'paste') { if (clipboard) await execute({ ...clipboard,directory:current }); return; }
    if (kind === 'mkdir' || kind === 'rename') {
      busy = true; updateActions();
      const answer = await choose(kind === 'mkdir' ? '请输入新文件夹名称。' : '请输入新名称。',[{label:'确定',value:'name'},{label:'取消',value:'cancel'}],kind === 'rename' ? entries.find(/* 使用已选项目名称作为初值。 */ entry => entry.path === sources[0])?.name : '新建文件夹');
      busy = false; updateActions();
      if (answer === 'cancel') return;
      await execute({ kind,directory:current,sources,name:answer.slice(5) }); return;
    }
    if (kind === 'delete') await execute({ kind:'delete',sources });
  }
  element.querySelector('[data-home]')!.addEventListener('click',home);
  element.querySelector('[data-computer]')!.addEventListener('click', /* 返回磁盘入口。 */ () => { void navigate(''); });
  element.querySelector('[data-refresh]')!.addEventListener('click', /* 重新核对当前目录。 */ () => { void navigate(current); });
  element.querySelector('[data-up]')!.addEventListener('click', /* 在盘符根目录返回此电脑。 */ () => { const trimmed = current.replace(/[\\/]$/,''); void navigate(/^[A-Za-z]:$/.test(trimmed) || !trimmed ? '' : trimmed.replace(/[\\/][^\\/]*$/,'') + '\\'); });
  element.querySelector('form')!.addEventListener('submit', /* 允许直接输入本地路径。 */ event => { event.preventDefault(); void navigate(address.value.trim()); });
  for (const control of element.querySelectorAll<HTMLButtonElement>('[data-action]')) control.addEventListener('click', /* 调用当前工具栏动作。 */ () => { void action(control.dataset.action!); });
  overlay.addEventListener('keydown', /* 确认层限制焦点，避免键盘误触后台操作。 */ event => {
    if (event.key === 'Escape') { event.stopPropagation(); dismiss?.(); }
    if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll<HTMLElement>('input:not([hidden]),button')]; const index = controls.indexOf(document.activeElement as HTMLElement);
      event.preventDefault(); controls[(index + (event.shiftKey ? controls.length-1 : 1)) % controls.length]?.focus();
    }
  });
  window.desktop.onFilesSnapshot(receive); window.desktop.onFileQuestion(/* 异步显示主进程提问。 */ value => { void question(value); });
  updateActions();
  return {
    element,
    /** 隐藏时释放系统监听，再次进入自动核对之前的位置。 */
    setVisible(value:boolean) {
      element.hidden = !value; if (visible === value) return; visible = value;
      if (value) {
        void window.desktop.filePlaces().then(/* 初始化系统常用目录。 */ places => { shortcuts = places; renderPlaces(); }).catch(/* 常用目录失败仍可浏览磁盘。 */ error => { status.textContent = String(error); });
        void navigate(current);
      } else { dismiss?.(); window.desktop.closeFiles(); }
    },
  };
}
