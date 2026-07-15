/**
 * 数据质量检测工具 — 主控制器
 * 4步向导：导入 → 规则 → 检测 → 报告
 */
const App = {
    // ── 全局状态 ──
    state: {
        currentStep: 1,
        furthestStep: 1,
        sessionId: null,
        templateId: null,
        filename: null,
        totalRows: 0,
        customTables: [],   // 自定义模板上传的表 [{key, name, headers}]
        allCustomFields: [], // 自定义模板的所有字段名集合
        headers: [],
        template: null,
        rules: [],
        // Keep the rule-dimension accordion state when the rule list is re-rendered.
        expandedDimensions: [],
        result: null,
        // Multi-table support
        tableFiles: {},     // {tableKey: {file, preview, uploaded}}
    },

    // ── 面板收起/展开 ──

    togglePanel(bodyId, titleEl) {
        var body = document.getElementById(bodyId);
        var arrow = titleEl.querySelector('.panel-arrow');
        if (!body || !arrow) return;
        var wasCollapsed = body.classList.contains('collapsed');
        var collapsed = body.classList.toggle('collapsed');
        arrow.classList.toggle('collapsed', collapsed);
        // 展开数据预览面板时刷新上传区
        if (wasCollapsed && bodyId === 'panel-body-2') {
            this.renderDataUploadZones();
        }
    },

    // ── 初始化 ──

    async init() {
        this.bindEvents();
        this.goStep(1);
        this.onTemplateChange('finance');
    },

    // ── 步骤导航 ──

    goStep(step) {
        this.state.currentStep = step;
        // 记录最远到达步骤
        if (step > this.state.furthestStep) {
            this.state.furthestStep = step;
        }
        // 更新步骤指示器 — done 基于 furthestStep，clickable 也基于 furthestStep
        var f = this.state.furthestStep;
        document.querySelectorAll('.step-item').forEach((el, i) => {
            var s = i + 1;
            el.classList.toggle('clickable', s <= f && s !== step);
        });
        document.querySelectorAll('.step-dot').forEach((el, i) => {
            var s = i + 1;
            el.classList.toggle('active', s === step);
            el.classList.toggle('done', s <= f && s !== step);
        });
        document.querySelectorAll('.step-line').forEach((el, i) => {
            el.classList.toggle('active', i + 1 < step);
        });
        // 显示/隐藏步骤内容
        for (let s = 1; s <= 4; s++) {
            const el = document.getElementById(`step-${s}`);
            if (el) el.style.display = s === step ? 'block' : 'none';
        }
        // 按钮状态
        document.getElementById('btn-prev').style.display = step > 1 ? 'inline-block' : 'none';
        document.getElementById('btn-next').style.display = step < 4 ? 'inline-block' : 'none';
        document.getElementById('btn-done').style.display = step === 4 ? 'inline-block' : 'none';

        // 进入步骤的回调
        if (step === 2) this.onEnterRules();
        if (step === 4) this.onEnterReport();
    },

    nextStep() {
        if (this.state.currentStep === 1 && !this.state.sessionId) {
            this.showToast('请先在面板2预览数据，再在面板3确认上传', 'warn');
            return;
        }
        if (this.state.currentStep < 4) {
            this.goStep(this.state.currentStep + 1);
        }
    },

    prevStep() {
        if (this.state.currentStep > 1) {
            this.goStep(this.state.currentStep - 1);
        }
    },

    // ── 事件绑定 ──

    bindEvents() {
        document.getElementById('btn-next').addEventListener('click', () => this.nextStep());
        document.getElementById('btn-prev').addEventListener('click', () => this.prevStep());
        document.getElementById('btn-done').addEventListener('click', () => this.goStep(1));

        // 步骤指示器点击 — 已到达过的步骤可跳转（当前步骤除外）
        document.querySelectorAll('.step-item').forEach(el => {
            el.addEventListener('click', () => {
                var step = parseInt(el.getAttribute('data-step'));
                if (step <= this.state.furthestStep && step !== this.state.currentStep) {
                    this.goStep(step);
                }
            });
        });

        // Step 1: 模板切换
        document.getElementById('template-select').addEventListener('change', (e) => {
            this.onTemplateChange(e.target.value);
        });

        // Step 1 panel 1: 自定义模板 — 上传表定义CSV
        var dzTpl = document.getElementById('drop-zone-tpl');
        if (dzTpl) {
            dzTpl.addEventListener('dragover', (e) => { e.preventDefault(); dzTpl.classList.add('dragover'); });
            dzTpl.addEventListener('dragleave', () => dzTpl.classList.remove('dragover'));
            dzTpl.addEventListener('drop', (e) => {
                e.preventDefault();
                dzTpl.classList.remove('dragover');
                if (e.dataTransfer.files[0]) this.uploadCustomTable(e.dataTransfer.files[0]);
            });
            dzTpl.addEventListener('click', () => document.getElementById('file-input-tpl').click());
        }
        var ftTpl = document.getElementById('file-input-tpl');
        if (ftTpl) ftTpl.addEventListener('change', (e) => { if (e.target.files[0]) this.uploadCustomTable(e.target.files[0]); });

        // Step 1 panel 3: 确认上传
        var btnUp = document.getElementById('btn-confirm-upload');
        if (btnUp) btnUp.addEventListener('click', () => this.confirmUpload());

        // Step 2: 新增规则表单（弹窗）
        document.getElementById('btn-add-rule').addEventListener('click', () => this.showRuleForm(null));
        document.getElementById('btn-smart-rule').addEventListener('click', () => this.showSmartRuleForm());
        document.getElementById('modal-smart-rule-parse').addEventListener('click', () => this.parseNaturalLanguageRule());
        document.getElementById('modal-btn-cancel').addEventListener('click', () => this.hideRuleForm());
        document.getElementById('modal-btn-save').addEventListener('click', () => this.saveCustomRule());
        // 点击遮罩关闭
        document.getElementById('rule-modal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('rule-modal')) this.hideRuleForm();
        });
        document.getElementById('msg-modal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('msg-modal')) this.closeMsgModal();
        });

        // Step 3: 开始检测
        document.getElementById('btn-start-check').addEventListener('click', () => this.startCheck());

        // Step 4: 下载PDF
        var btnDownloadPdf = document.getElementById('btn-download-pdf');
        if (btnDownloadPdf) btnDownloadPdf.addEventListener('click', () => this.downloadPDF());
    },

    // ═══════════════════════════════════════════
    // Step 1: 数据导入
    // ═══════════════════════════════════════════

    async loadTemplates() {
        // Templates hardcoded in HTML; init() already loads default
        var select = document.getElementById('template-select');
        if (select) select.value = 'finance';
    },

    // ── Panel 1: 模板切换 ──

    onTemplateChange(templateId) {
        this.state.templateId = templateId;
        this.state.customTables = [];
        this.state.allCustomFields = [];

        if (templateId === 'custom') {
            // 隐藏模板定义上传区，仅显示提示
            var cta = document.getElementById('custom-template-area');
            if (cta) cta.style.display = 'none';
            document.getElementById('template-fields').innerHTML =
                '<p class="hint">自定义模式：直接在下方"数据预览"面板中上传CSV文件，每个文件作为一张表</p>';
            this.state.customTables = [];
            this.state.tableFiles = {};
            document.getElementById('data-upload-zones').innerHTML = '';
            document.getElementById('data-upload-hint').style.display = 'none';
            this.renderDataUploadZones();
            return;
        }

        var cta2 = document.getElementById('custom-template-area');
        if (cta2) cta2.style.display = 'none';
        // 清除自定义表数据
        this.state.customTables = [];
        this.state.tableFiles = {};
        document.getElementById('template-fields').innerHTML = '<p class="hint">加载模板中...</p>';
        fetch('/api/import/templates/' + templateId)
            .then(function(r) { return r.json(); })
            .then(function(res) {
                if (res.status === 'ok' && res.template) {
                    App.state.template = res.template;
                    App.renderTemplateFields(res.template);
                    App.renderDataUploadZones();
                }
            }).catch(function(e) {
                console.error('Load template error:', e);
            });
    },

    renderTemplateFields(template) {
        var tid = this.state.templateId || template.id;
        var html = '<div class="field-tags">';
        (template.tables || []).forEach(function(table) {
            html += '<div class="table-group">';
            html += '<div class="table-name-row">';
            html += '<span class="table-name">📋 ' + table.name + '</span>';
            html += '<a class="btn-download-tpl" href="/api/import/templates/' + tid + '/download/' + table.table_key + '" download title="下载此表的CSV模板">⬇ 下载模板</a>';
            html += '</div>';
            (table.fields || []).forEach(function(f) {
                var required = f.required ? '<span class="required">*</span>' : '';
                html += '<span class="field-tag">' + f.name + required + ' <small>(' + f.type + ')</small></span>';
            });
            html += '</div>';
        });
        html += '</div>';
        document.getElementById('template-fields').innerHTML = html;
    },

    // ── Panel 1: 自定义模板 — 上传表定义CSV ──

    async uploadCustomTable(file) {
        if (!file || !file.name.endsWith('.csv')) {
            this.showToast('请选择CSV文件', 'error');
            return;
        }
        var formData = new FormData();
        formData.append('file', file);
        try {
            var res = await API.upload('/import/preview-csv', formData);
            if (res.status === 'ok') {
                // 用文件名（去掉.csv）作为表名
                var tableName = file.name.replace(/\.csv$/i, '');
                var tableKey = 'tbl_' + Date.now();
                this.state.customTables.push({
                    key: tableKey,
                    name: tableName,
                    headers: res.headers,
                });
                // 收集所有自定义字段
                res.headers.forEach(function(h) {
                    if (App.state.allCustomFields.indexOf(h) === -1) {
                        App.state.allCustomFields.push(h);
                    }
                });
                this.renderCustomTables();
            } else {
                this.showToast(res.message || '解析失败', 'error');
            }
        } catch (e) {
            this.showToast('解析失败，请重试', 'error');
        }
    },

    renderCustomTables() {
        var container = document.getElementById('custom-tables');
        if (this.state.customTables.length === 0) {
            container.innerHTML = '<p class="hint">上传表定义CSV，系统自动解析字段名</p>';
            return;
        }
        var html = '';
        this.state.customTables.forEach(function(t, idx) {
            html += '<div class="custom-table-card">';
            html += '<div class="ctc-info"><span class="ctc-name">📋 ' + t.name + '</span>';
            html += '<span class="ctc-fields">' + t.headers.join(', ') + '</span></div>';
            html += '<button class="ctc-del" onclick="App.removeCustomTable(' + idx + ')">🗑️删除</button>';
            html += '</div>';
        });
        container.innerHTML = html;
        // 刷新上传区
        this.renderDataUploadZones();
    },

    removeCustomTable(idx) {
        this.state.customTables.splice(idx, 1);
        // 重建 allCustomFields
        this.state.allCustomFields = [];
        this.state.customTables.forEach(function(t) {
            t.headers.forEach(function(h) {
                if (App.state.allCustomFields.indexOf(h) === -1) {
                    App.state.allCustomFields.push(h);
                }
            });
        });
        this.renderCustomTables();
    },

    // ── 动态渲染数据上传区（多表支持）──

    renderDataUploadZones() {
        var container = document.getElementById('data-upload-zones');
        var hint = document.getElementById('data-upload-hint');
        if (!container) return;

        // 预设模板但尚未加载：触发加载
        var isCustom = this.state.templateId === 'custom';
        if (!isCustom && !this.state.template && this.state.templateId) {
            this.onTemplateChange(this.state.templateId);
            return;
        }

        // 确定需要展示的表列表
        var tables = [];
        if (!isCustom && this.state.template) {
            (this.state.template.tables || []).forEach(function(t) {
                tables.push({ key: t.table_key, name: t.name, headers: t.fields.map(function(f) { return f.name; }) });
            });
        } else if (isCustom) {
            tables = this.state.customTables.map(function(t) {
                return { key: t.key, name: t.name, headers: t.headers };
            });
            // 自定义模式：始终保证至少一个空上传区
            if (tables.length === 0) {
                hint.style.display = 'none';
                var key = 'tbl_' + Date.now();
                container.innerHTML =
                    '<div class="table-group" style="margin-bottom:12px;">'
                    + '<div class="table-name-row"><span class="table-name">📋 新表</span></div>'
                    + '<div class="drop-zone drop-zone-upload" style="padding:20px;"'
                    + ' ondrop="App.handleCustomDrop(event)"'
                    + ' ondragover="event.preventDefault();this.classList.add(\'dragover\')"'
                    + ' ondragleave="this.classList.remove(\'dragover\')">'
                    + '<div class="dz-icon">📁</div>'
                    + '<div class="dz-text">拖拽 CSV 到此处，或点击选择</div>'
                    + '<div class="dz-hint">文件将自动作为一张新表</div>'
                    + '<input type="file" accept=".csv" class="drop-zone-input"'
                    + ' onchange="App.handleCustomFileSelect(this)">'
                    + '</div></div>';
                return;
            }
        }

        if (tables.length === 0) {
            hint.style.display = 'block';
            container.innerHTML = '';
            return;
        }

        hint.style.display = 'none';
        var html = '';
        tables.forEach(function(tbl) {
            var tf = App.state.tableFiles[tbl.key];
            var uploaded = tf && tf.uploaded;
            html += '<div class="table-group" style="margin-bottom:12px;">';
            html += '<div class="table-name-row">';
            html += '<span class="table-name">📋 ' + tbl.name + '</span>';
            if (uploaded) {
                html += '<span style="color:#52c41a;font-size:0.8rem;">✅ 已上传 ' + tf.rows + ' 行</span>';
            }
            html += '</div>';
            if (!uploaded) {
                html += '<div class="drop-zone drop-zone-upload" style="padding:20px;"';
                html += ' ondrop="App.handleTableDrop(event,\'' + tbl.key + '\')"';
                html += ' ondragover="event.preventDefault();this.classList.add(\'dragover\')"';
                html += ' ondragleave="this.classList.remove(\'dragover\')">';
                html += '<div class="dz-icon">📁</div>';
                html += '<div class="dz-text">拖拽 ' + tbl.name + ' CSV 到此处，或点击选择</div>';
                html += '<div class="dz-hint">字段: ' + (tbl.headers || []).slice(0, 5).join(', ') + ((tbl.headers||[]).length > 5 ? '...' : '') + '</div>';
                html += '<input type="file" accept=".csv" class="drop-zone-input"';
                html += ' onchange="App.handleTableFileSelect(this,\'' + tbl.key + '\')">';
                html += '</div>';
            }
            if (tf && tf.preview) {
                html += '<div style="margin-top:8px;" id="pv-' + tbl.key + '">' + App._buildPreviewHTML(tf.preview, tbl.key) + '</div>';
            } else if (uploaded) {
                html += '<div style="margin-top:4px;color:#52c41a;font-size:0.85rem;">' + tf.rows + ' 行数据已就绪</div>';
            }
            html += '</div>';
        });
        // 自定义模式：添加新表按钮
        if (isCustom && tables.length > 0) {
            html += '<div style="text-align:center;padding:8px;">';
            html += '<button class="btn btn-outline btn-sm" onclick="App.addCustomTableSlot()">+ 添加新表</button>';
            html += '</div>';
        }
        container.innerHTML = html;

    },

    // 表文件处理（由 inline onclick 调用）
    handleTableDrop(e, tableKey) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        if (e.dataTransfer.files[0]) this.previewTableFile(tableKey, e.dataTransfer.files[0]);
    },

    handleTableFileSelect(input, tableKey) {
        if (input.files[0]) this.previewTableFile(tableKey, input.files[0]);
        input.value = '';
    },

    // 自定义模式：新文件自动成为新表
    handleCustomDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        if (e.dataTransfer.files[0]) this.addCustomTableFromFile(e.dataTransfer.files[0]);
    },

    handleCustomFileSelect(input) {
        if (input.files[0]) this.addCustomTableFromFile(input.files[0]);
        input.value = '';
    },

    addCustomTableSlot() {
        var key = 'tbl_' + Date.now();
        this.state.customTables.push({ key: key, name: '新表', headers: [] });
        this.renderDataUploadZones();
        this.updateConfirmButton();
    },

    async addCustomTableFromFile(file) {
        if (!file || !file.name.endsWith('.csv')) {
            this.showToast('请选择CSV文件', 'error');
            return;
        }
        var formData = new FormData();
        formData.append('file', file);
        try {
            var res = await API.upload('/import/preview-csv', formData);
            if (res.status === 'ok') {
                var tableName = file.name.replace(/\.csv$/i, '');
                var key = 'tbl_' + Date.now();
                // 替换空表槽位
                var emptyIdx = -1;
                for (var i = 0; i < this.state.customTables.length; i++) {
                    if (this.state.customTables[i].headers.length === 0) { emptyIdx = i; break; }
                }
                if (emptyIdx >= 0) this.state.customTables.splice(emptyIdx, 1);
                this.state.customTables.push({ key: key, name: tableName, headers: res.headers });

                res.headers.forEach(function(h) {
                    if (App.state.allCustomFields.indexOf(h) === -1) App.state.allCustomFields.push(h);
                });

                if (!this.state.tableFiles[key]) this.state.tableFiles[key] = {};
                this.state.tableFiles[key].file = file;
                this.state.tableFiles[key].preview = {
                    headers: res.headers, total_rows: res.total_rows, preview_rows: res.preview_rows,
                };
                this.state.tableFiles[key].uploaded = false;

                this.renderDataUploadZones();
                this.updateConfirmButton();
            } else {
                this.showToast(res.message || '解析失败', 'error');
            }
        } catch (e) {
            this.showToast('解析失败，请重试', 'error');
        }
    },

    _buildPreviewHTML(preview, tableKey) {
        var keys = preview.headers;
        var html = '<div class="preview-info" style="font-size:0.78rem;color:#888;margin-bottom:6px;">共 ' + preview.total_rows + ' 行 · 显示前 ' + preview.preview_rows.length + ' 行</div>';
        html += '<div class="table-wrap"><table><thead><tr><th>#</th>';
        keys.forEach(function(k) { html += '<th>' + k + '</th>'; });
        html += '</tr></thead><tbody>';
        preview.preview_rows.forEach(function(row, i) {
            html += '<tr><td>' + (i + 1) + '</td>';
            keys.forEach(function(k) {
                var val = row[k] !== undefined ? String(row[k]).substring(0, 30) : '';
                html += '<td title="' + val + '">' + val + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        return html;
    },

    // 获取某张表的预设字段名列表
    _getExpectedFields(tableKey) {
        if (this.state.templateId !== 'custom' && this.state.template) {
            var tbl = (this.state.template.tables || []).find(function(t) { return t.table_key === tableKey; });
            if (tbl) return (tbl.fields || []).map(function(f) { return f.name; });
        }
        if (this.state.templateId === 'custom') {
            var ct = this.state.customTables.find(function(t) { return t.key === tableKey; });
            if (ct) return ct.headers || [];
        }
        return null;
    },

    async previewTableFile(tableKey, file) {
        if (!file || !file.name.endsWith('.csv')) {
            this.showToast('请选择CSV文件', 'error');
            return;
        }
        var formData = new FormData();
        formData.append('file', file);
        try {
            var res = await API.upload('/import/preview-csv', formData);
            if (res.status === 'ok') {
                // 字段校验
                var expected = this._getExpectedFields(tableKey);
                if (expected && expected.length > 0) {
                    var uploadedHeaders = res.headers || [];
                    var missing = expected.filter(function(f) { return uploadedHeaders.indexOf(f) === -1; });
                    var extra = uploadedHeaders.filter(function(f) { return expected.indexOf(f) === -1; });
                    if (missing.length > 0 || extra.length > 0) {
                        var lines = [];
                        if (missing.length > 0) lines.push('缺少字段：' + missing.join('、'));
                        if (extra.length > 0) lines.push('多余字段：' + extra.join('、'));
                        lines.push('模板需要 ' + expected.length + ' 个字段，上传了 ' + uploadedHeaders.length + ' 个字段');
                        lines.push('请确认文件是否正确，重新上传');
                        this.showMsgModal('字段不匹配', lines.join('\n'));
                        return;
                    }
                }

                if (!this.state.tableFiles[tableKey]) this.state.tableFiles[tableKey] = {};
                this.state.tableFiles[tableKey].file = file;
                this.state.tableFiles[tableKey].preview = {
                    headers: res.headers,
                    total_rows: res.total_rows,
                    preview_rows: res.preview_rows,
                };
                this.state.tableFiles[tableKey].uploaded = false;

                // 重新渲染上传区以显示预览表
                this.renderDataUploadZones();

                // 自定义模式：更新表名（如果还是默认名称）
                if (this.state.templateId === 'custom') {
                    var ct = this.state.customTables.find(function(t) { return t.key === tableKey; });
                    if (ct && ct.name === '新表') {
                        ct.name = file.name.replace(/\.csv$/i, '');
                        ct.headers = res.headers;
                    }
                    res.headers.forEach(function(h) {
                        if (App.state.allCustomFields.indexOf(h) === -1) App.state.allCustomFields.push(h);
                    });
                }
                this.updateConfirmButton();
            } else {
                this.showToast(res.message || '解析失败', 'error');
            }
        } catch (e) {
            this.showToast('预览失败，请重试', 'error');
        }
    },

    updateConfirmButton() {
        var tables = this._getTableList();
        var hasAny = tables.some(function(t) { var tf = App.state.tableFiles[t.key]; return tf && tf.file; });
        document.getElementById('btn-confirm-upload').disabled = !hasAny;
    },

    _getTableList() {
        if (this.state.templateId !== 'custom' && this.state.template) {
            return (this.state.template.tables || []).map(function(t) { return { key: t.table_key, name: t.name }; });
        }
        return this.state.customTables.map(function(t) { return { key: t.key, name: t.name }; });
    },

    async confirmUpload() {
        var tables = this._getTableList();
        if (tables.length === 0) {
            this.showToast('请先在面板1选择模板', 'warn');
            return;
        }

        var statusEl = document.getElementById('upload-status');
        var statusesEl = document.getElementById('upload-statuses');
        statusEl.textContent = '正在上传...';
        statusEl.className = 'upload-status loading';
        statusesEl.innerHTML = '';

        // 为多表生成一个 session_id
        var sid = this.state.sessionId || '';
        var totalRows = 0;
        var allHeaders = [];
        var tableResults = [];

        for (var i = 0; i < tables.length; i++) {
            var tbl = tables[i];
            var tf = this.state.tableFiles[tbl.key];
            if (!tf || !tf.file) continue;

            statusEl.textContent = '正在上传: ' + tbl.name + ' (' + (i + 1) + '/' + tables.length + ')...';

            var formData = new FormData();
            formData.append('file', tf.file);
            formData.append('template_id', this.state.templateId || 'custom');
            formData.append('table_key', tbl.key);
            formData.append('session_id', sid);

            try {
                var res = await API.upload('/import/upload', formData);
                if (res.status === 'ok') {
                    sid = res.session_id;
                    totalRows += res.total_rows;
                    allHeaders = allHeaders.concat(res.headers);
                    tf.uploaded = true;
                    tf.rows = res.total_rows;
                    tableResults.push('✅ ' + tbl.name + ' 上传成功：' + res.total_rows + ' 行');
                } else {
                    statusEl.textContent = '❌ ' + tbl.name + ': ' + (res.message || '上传失败');
                    statusEl.className = 'upload-status error';
                    return;
                }
            } catch (e) {
                statusEl.textContent = '❌ ' + tbl.name + ' 上传失败，请重试';
                statusEl.className = 'upload-status error';
                return;
            }
        }

        this.state.sessionId = sid;
        this.state.totalRows = totalRows;
        this.state.headers = allHeaders.filter(function(v, i, a) { return a.indexOf(v) === i; });
        statusEl.innerHTML = tableResults.join('<br>') + '<br><span style="font-size:0.8rem;">共 ' + totalRows + ' 行</span>';
        statusEl.className = 'upload-status success';
        statusEl.style.whiteSpace = 'normal';
        document.getElementById('btn-next').disabled = false;

        // 重新渲染上传区显示"已上传"
        this.renderDataUploadZones();
    },

    // ═══════════════════════════════════════════
    // Step 2: 规则配置
    // ═══════════════════════════════════════════

    async onEnterRules() {
        if (!this.state.sessionId) {
            document.getElementById('rules-list').innerHTML =
                '<p class="hint error">请先在步骤1中上传数据，再配置规则</p>';
            return;
        }
        document.getElementById('rules-loading').style.display = 'block';
        document.getElementById('rules-list').innerHTML = '';

        try {
            const res = await API.get(`/rules?session_id=${this.state.sessionId}`);
            if (res.status === 'ok') {
                this.state.rules = res.rules;
                this.renderRules(res.rules);
                this.updateRuleStats(this.getApplicableRuleStats(res.rules));
            } else {
                this.showToast('加载规则失败', 'error');
            }
        } catch (e) {
            console.error('加载规则失败:', e);
            this.showToast('加载规则失败', 'error');
        }
        document.getElementById('rules-loading').style.display = 'none';
    },

    renderRules(rules) {
        // 按维度分组
        const dims = ['完整性', '准确性', '一致性', '逻辑性'];
        const uploadedFields = this.getUploadedFieldNames();
        let html = '';
        dims.forEach(dim => {
            const dimRules = rules.filter(r => r.dimension === dim);
            if (dimRules.length === 0) return;
            const enabledCount = dimRules.filter(r => r.enabled && uploadedFields.includes(r.field_name)).length;
            const isExpanded = this.state.expandedDimensions.includes(dim);
            html += `<div class="dim-group">`;
            html += `<div class="dim-header" data-dimension="${dim}" onclick="App.toggleDim(this)">`;
            html += `<span>${dim} <span class="dim-count">${enabledCount}/${dimRules.length} 启用</span></span>`;
            html += `<span class="dim-arrow">${isExpanded ? '▼' : '▶'}</span>`;
            html += `</div>`;
            html += `<div class="dim-body" style="display:${isExpanded ? 'block' : 'none'}">`;
            dimRules.forEach(r => {
                const isApplicable = uploadedFields.includes(r.field_name);
                const isOn = r.enabled === 1 && isApplicable;
                const isCustom = r.is_default === 0;
                const escapedId = r.rule_id.replace(/'/g, "\\'");
                const unavailableHint = isApplicable ? '' : ' · <span class="custom-badge">当前数据不含此字段，已停用</span>';
                html += `<div class="rule-item ${isOn ? '' : 'disabled'}">`;
                html += `<label class="toggle-switch">`;
                html += `<input type="checkbox" ${isOn ? 'checked' : ''} ${isApplicable ? '' : 'disabled'} title="${isApplicable ? '' : '当前上传数据不含该字段'}" onchange="App.toggleRule('${escapedId}', this.checked)">`;
                html += `<span class="toggle-slider"></span>`;
                html += `</label>`;
                html += `<div class="rule-info">`;
                html += `<span class="rule-name">${r.rule_name}</span>`;
                html += `<span class="rule-meta">${r.field_name} · ${r.rule_type} · <span class="severity severity-${r.severity}">${r.severity}</span>${isCustom ? ' · <span class="custom-badge">自定义</span>' : ''}${unavailableHint}</span>`;
                html += `</div>`;
                html += `<button class="btn-icon" onclick="App.editRule('${escapedId}')" title="编辑">✏️</button>`;
                html += `<button class="btn-icon danger" onclick="App.deleteRule('${escapedId}')" title="删除">🗑️</button>`;
                html += `</div>`;
            });
            html += `</div></div>`;
        });

        document.getElementById('rules-list').innerHTML = html;
    },

    updateRuleStats(stats) {
        document.getElementById('rule-stats').textContent =
            `共 ${stats.total} 条规则 · 已启用 ${stats.enabled} 条 · 已停用 ${stats.disabled} 条`;
    },

    getUploadedFieldNames() {
        return (this.state.headers || []).filter(function(field, index, fields) {
            return fields.indexOf(field) === index;
        });
    },

    getApplicableRuleStats(rules) {
        const uploadedFields = this.getUploadedFieldNames();
        const applicableRules = rules.filter(function(rule) {
            return uploadedFields.includes(rule.field_name);
        });
        return {
            total: applicableRules.length,
            enabled: applicableRules.filter(function(rule) { return rule.enabled === 1; }).length,
            disabled: applicableRules.filter(function(rule) { return rule.enabled !== 1; }).length,
        };
    },

    toggleDim(header) {
        var body = header.nextElementSibling;
        var arrow = header.querySelector('.dim-arrow');
        var isOpen = body.style.display !== 'none';
        var dimension = header.dataset.dimension;
        body.style.display = isOpen ? 'none' : 'block';
        arrow.textContent = isOpen ? '▶' : '▼';
        if (dimension) {
            if (isOpen) {
                this.state.expandedDimensions = this.state.expandedDimensions.filter(d => d !== dimension);
            } else if (!this.state.expandedDimensions.includes(dimension)) {
                this.state.expandedDimensions.push(dimension);
            }
        }
    },

    async toggleRule(ruleId, enabled) {
        try {
            await API.put(`/rules/${ruleId}/toggle`, { enabled });
            // 更新本地状态
            const rule = this.state.rules.find(r => r.rule_id === ruleId);
            if (rule) rule.enabled = enabled ? 1 : 0;
            this.renderRules(this.state.rules);
        } catch (e) {
            console.error('切换规则失败:', e);
        }
    },

    showRuleForm(rule) {
        // rule is optional — if provided, we're in edit mode
        this._editingRuleId = rule ? rule.rule_id : null;
        this._smartRuleConfig = null;
        document.getElementById('rule-modal-title').textContent = rule ? '编辑规则' : '新增自定义规则';
        document.getElementById('rule-modal').classList.add('show');
        this.populateModalFieldDropdown();
        if (rule) {
            document.getElementById('modal-rule-name').value = rule.rule_name || '';
            document.getElementById('modal-rule-type').value = rule.rule_type || '';
            document.getElementById('modal-rule-field').value = rule.field_name || '';
            document.getElementById('modal-rule-dim').value = rule.dimension || '';
            document.getElementById('modal-rule-sev').value = rule.severity || '中';
            if (rule.config) {
                document.getElementById('modal-regex-pattern').value = rule.config.pattern || '';
                document.getElementById('modal-range-min').value = rule.config.min !== undefined && rule.config.min !== null ? rule.config.min : '';
                document.getElementById('modal-range-max').value = rule.config.max !== undefined && rule.config.max !== null ? rule.config.max : '';
                document.getElementById('modal-len-min').value = rule.config.min_len || '';
                document.getElementById('modal-len-max').value = rule.config.max_len || '';
            } else {
                ['modal-regex-pattern','modal-range-min','modal-range-max','modal-len-min','modal-len-max'].forEach(function(id) { document.getElementById(id).value = ''; });
            }
            this.onModalRuleTypeChange();
            if (rule.rule_type === 'reference_exists' && rule.config) {
                document.getElementById('modal-ref-source-table').value = rule.config.source_table_key || '';
                this.onReferenceSourceTableChange();
                document.getElementById('modal-rule-field').value = rule.field_name || '';
                document.getElementById('modal-ref-target-table').value = rule.config.target_table_key || '';
                this.onReferenceTargetTableChange();
                document.getElementById('modal-ref-target-field').value = rule.config.target_field || '';
            }
        } else {
            ['modal-rule-name','modal-rule-type','modal-rule-field','modal-rule-dim','modal-rule-sev',
             'modal-regex-pattern','modal-range-min','modal-range-max','modal-len-min','modal-len-max'].forEach(function(id) { document.getElementById(id).value = ''; });
            this.onModalRuleTypeChange();
        }
    },

    showSmartRuleForm() {
        this.showRuleForm(null);
        setTimeout(function() { document.getElementById('modal-smart-rule-text').focus(); }, 0);
    },

    async parseNaturalLanguageRule() {
        var input = document.getElementById('modal-smart-rule-text');
        var hint = document.getElementById('modal-smart-rule-hint');
        var text = input.value.trim();
        var fields = this.getUploadedFieldNames();
        if (!text) { hint.textContent = '请输入规则描述，例如“交易对手不能为空”。'; return; }
        if (!fields.length) { hint.textContent = '请先上传数据，系统才能识别目标字段。'; return; }

        hint.textContent = '正在识别规则…';
        try {
            var res = await API.post('/rules/parse', { text: text, fields: fields, tables: this.getRuleTables() });
            if (res.status !== 'ok') { hint.textContent = res.message || '未能识别该规则，请换一种说法。'; return; }
            var rule = res.rule;
            document.getElementById('modal-rule-name').value = rule.rule_name || text;
            document.getElementById('modal-rule-type').value = rule.rule_type || '';
            document.getElementById('modal-rule-field').value = rule.field_name || '';
            document.getElementById('modal-rule-dim').value = rule.dimension || '';
            document.getElementById('modal-rule-sev').value = rule.severity || '中';
            document.getElementById('modal-regex-pattern').value = (rule.config && rule.config.pattern) || '';
            document.getElementById('modal-range-min').value = rule.config && rule.config.min !== undefined ? rule.config.min : '';
            document.getElementById('modal-range-max').value = rule.config && rule.config.max !== undefined ? rule.config.max : '';
            document.getElementById('modal-len-min').value = (rule.config && rule.config.min_len) || '';
            document.getElementById('modal-len-max').value = (rule.config && rule.config.max_len) || '';
            this._smartRuleConfig = rule.config || null;
            this.onModalRuleTypeChange();
            if (rule.rule_type === 'reference_exists' && rule.config) {
                document.getElementById('modal-ref-source-table').value = rule.config.source_table_key || '';
                this.onReferenceSourceTableChange();
                document.getElementById('modal-rule-field').value = rule.field_name || '';
                document.getElementById('modal-ref-target-table').value = rule.config.target_table_key || '';
                this.onReferenceTargetTableChange();
                document.getElementById('modal-ref-target-field').value = rule.config.target_field || '';
            }
            hint.textContent = rule.explanation || '已完成智能填充，请确认后保存。';
        } catch (e) {
            hint.textContent = '智能生成失败，请检查网络后重试。';
        }
    },

    editRule(ruleId) {
        var rule = this.state.rules.find(function(r) { return r.rule_id === ruleId; });
        if (!rule) { this.showToast('规则不存在', 'error'); return; }
        this.showRuleForm(rule);
    },

    onModalRuleTypeChange() {
        var type = document.getElementById('modal-rule-type').value;
        document.getElementById('modal-config-regex').style.display = type === 'regex' ? 'flex' : 'none';
        document.getElementById('modal-config-range').style.display = type === 'range' ? 'flex' : 'none';
        document.getElementById('modal-config-length').style.display = type === 'length' ? 'flex' : 'none';
        document.getElementById('modal-config-reference').style.display = type === 'reference_exists' ? 'flex' : 'none';
        if (type === 'reference_exists') this.populateReferenceTables();

        var hints = {
            not_null: '💡 非空校验：无需额外配置，系统将检查该字段是否为空值。',
            unique: '💡 唯一性校验：无需额外配置，系统将检查该字段的值在所有数据行中是否重复。',
            regex: '💡 正则格式校验：请填写正则表达式，用于校验字段格式。例如手机号可填 ^1[3-9]\\d{9}$，邮箱可填 ^[^@]+@[^@]+\\.[^@]+$',
            range: '💡 数值范围校验：请填写最小值和/或最大值（可只填一个），用于校验数值是否在合理区间内，例如金额需大于0。',
            length: '💡 长度校验：请填写最小长度和/或最大长度（可只填一个），用于校验字符串长度，例如身份证号需为18位。',
            reference_exists: '💡 跨表关联校验：选择源表和源字段，再选择目标表及目标字段。系统将检查源表中的每个值是否都能在目标表中找到。',
        };
        var hintEl = document.getElementById('modal-type-hint');
        if (hints[type]) {
            hintEl.textContent = hints[type];
            hintEl.classList.add('show');
        } else {
            hintEl.classList.remove('show');
        }
    },

    hideRuleForm() {
        document.getElementById('rule-modal').classList.remove('show');
        this._editingRuleId = null;
    },

    populateModalFieldDropdown() {
        var fields = [];
        if (this.state.template && this.state.templateId !== 'custom') {
            (this.state.template.tables || []).forEach(function(t) {
                (t.fields || []).forEach(function(f) {
                    if (fields.indexOf(f.name) === -1) fields.push(f.name);
                });
            });
        }
        if (this.state.allCustomFields && this.state.allCustomFields.length > 0) {
            this.state.allCustomFields.forEach(function(f) {
                if (fields.indexOf(f) === -1) fields.push(f);
            });
        }
        if (this.state.headers && this.state.headers.length > 0) {
            this.state.headers.forEach(function(h) {
                if (fields.indexOf(h) === -1) fields.push(h);
            });
        }
        var sel = document.getElementById('modal-rule-field');
        sel.innerHTML = '<option value="">选择目标字段</option>';
        fields.forEach(function(f) {
            sel.innerHTML += '<option value="' + f + '">' + f + '</option>';
        });
    },

    getRuleTables() {
        var tables = [];
        var addTable = function(key, name, headers) {
            if (!key || !headers || !headers.length || tables.some(function(table) { return table.key === key; })) return;
            tables.push({ key: key, name: name || key, headers: headers });
        };
        if (this.state.template && this.state.templateId !== 'custom') {
            (this.state.template.tables || []).forEach(function(table) {
                var file = App.state.tableFiles[table.table_key];
                if (file && (file.file || file.uploaded)) addTable(table.table_key, table.name, (table.fields || []).map(function(field) { return field.name; }));
            });
        }
        (this.state.customTables || []).forEach(function(table) {
            var file = App.state.tableFiles[table.key];
            if (file && (file.file || file.uploaded)) addTable(table.key, table.name, table.headers || []);
        });
        Object.keys(this.state.tableFiles || {}).forEach(function(key) {
            var file = App.state.tableFiles[key];
            if (file && file.preview) addTable(key, key, file.preview.headers || []);
        });
        return tables;
    },

    populateReferenceTables() {
        var tables = this.getRuleTables();
        var source = document.getElementById('modal-ref-source-table');
        var target = document.getElementById('modal-ref-target-table');
        var previousSource = source.value;
        var previousTarget = target.value;
        var options = '<option value="">选择表</option>' + tables.map(function(table) {
            return '<option value="' + table.key + '">' + table.name + '</option>';
        }).join('');
        source.innerHTML = options;
        target.innerHTML = options;
        source.value = tables.some(function(table) { return table.key === previousSource; }) ? previousSource : '';
        target.value = tables.some(function(table) { return table.key === previousTarget; }) ? previousTarget : '';
        this.onReferenceSourceTableChange();
        this.onReferenceTargetTableChange();
    },

    onReferenceSourceTableChange() {
        var sourceKey = document.getElementById('modal-ref-source-table').value;
        var table = this.getRuleTables().find(function(item) { return item.key === sourceKey; });
        var fieldSelect = document.getElementById('modal-rule-field');
        var previousField = fieldSelect.value;
        fieldSelect.innerHTML = '<option value="">选择源字段</option>' + (table ? table.headers.map(function(field) {
            return '<option value="' + field + '">' + field + '</option>';
        }).join('') : '');
        fieldSelect.value = table && table.headers.indexOf(previousField) >= 0 ? previousField : '';
    },

    onReferenceTargetTableChange() {
        var targetKey = document.getElementById('modal-ref-target-table').value;
        var table = this.getRuleTables().find(function(item) { return item.key === targetKey; });
        var fieldSelect = document.getElementById('modal-ref-target-field');
        var previousField = fieldSelect.value;
        fieldSelect.innerHTML = '<option value="">选择目标字段</option>' + (table ? table.headers.map(function(field) {
            return '<option value="' + field + '">' + field + '</option>';
        }).join('') : '');
        fieldSelect.value = table && table.headers.indexOf(previousField) >= 0 ? previousField : '';
    },

    async saveCustomRule() {
        var ruleType = document.getElementById('modal-rule-type').value;
        var config = null;
        if (ruleType === 'regex') {
            var pattern = document.getElementById('modal-regex-pattern').value.trim();
            if (!pattern) { this.showToast('请输入正则表达式', 'warn'); return; }
            config = { pattern: pattern };
        } else if (ruleType === 'range') {
            var rmin = document.getElementById('modal-range-min').value;
            var rmax = document.getElementById('modal-range-max').value;
            if (!rmin && !rmax) { this.showToast('请至少填写最小值或最大值', 'warn'); return; }
            config = {};
            if (rmin) config.min = parseFloat(rmin);
            if (rmax) config.max = parseFloat(rmax);
            if (this._smartRuleConfig && this._smartRuleConfig.min_exclusive && config.min === this._smartRuleConfig.min) config.min_exclusive = true;
            if (this._smartRuleConfig && this._smartRuleConfig.max_exclusive && config.max === this._smartRuleConfig.max) config.max_exclusive = true;
        } else if (ruleType === 'length') {
            var lmin = document.getElementById('modal-len-min').value;
            var lmax = document.getElementById('modal-len-max').value;
            if (!lmin && !lmax) { this.showToast('请至少填写最小长度或最大长度', 'warn'); return; }
            config = {};
            if (lmin) config.min_len = parseInt(lmin);
            if (lmax) config.max_len = parseInt(lmax);
        } else if (ruleType === 'reference_exists') {
            config = {
                source_table_key: document.getElementById('modal-ref-source-table').value,
                target_table_key: document.getElementById('modal-ref-target-table').value,
                target_field: document.getElementById('modal-ref-target-field').value,
            };
            if (!config.source_table_key || !config.target_table_key || !config.target_field) {
                this.showToast('请选择源表、目标表和目标字段', 'warn'); return;
            }
        }

        var data = {
            session_id: this.state.sessionId,
            rule_name: document.getElementById('modal-rule-name').value.trim(),
            rule_type: ruleType,
            field_name: document.getElementById('modal-rule-field').value,
            dimension: document.getElementById('modal-rule-dim').value,
            severity: document.getElementById('modal-rule-sev').value || '中',
            config: config,
        };

        if (!data.rule_name || !data.rule_type || !data.field_name || !data.dimension) {
            this.showToast('请填写完整信息', 'warn');
            return;
        }

        var isEdit = !!this._editingRuleId;
        try {
            if (isEdit) {
                const res = await API.put(`/rules/${this._editingRuleId}`, data);
                if (res.status === 'ok') {
                    this.showToast('规则已更新', 'success');
                } else {
                    this.showToast(res.message || '更新失败', 'error'); return;
                }
            } else {
                const res = await API.post('/rules/custom', data);
                if (res.status === 'ok') {
                    this.showToast('规则已添加', 'success');
                } else {
                    this.showToast(res.message || '添加失败', 'error'); return;
                }
            }
            this.hideRuleForm();
            await this.onEnterRules();
        } catch (e) {
            this.showToast(isEdit ? '更新失败' : '添加失败', 'error');
        }
    },

    async deleteRule(ruleId) {
        if (!confirm('确定删除这条规则？')) return;
        try {
            const res = await API.del(`/rules/${ruleId}`);
            if (res.status === 'ok') {
                this.showToast('规则已删除', 'success');
                await this.onEnterRules();
            } else {
                this.showToast(res.message || '删除失败', 'error');
            }
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    },

    // ═══════════════════════════════════════════
    // Step 3: 执行检测
    // ═══════════════════════════════════════════

    async startCheck() {
        if (!this.state.sessionId) {
            this.showToast('请先在步骤1中上传数据', 'warn');
            this.goStep(1);
            return;
        }
        const btn = document.getElementById('btn-start-check');
        btn.disabled = true;
        btn.textContent = '检测中...';
        document.getElementById('check-progress-bar').style.width = '0%';
        document.getElementById('check-progress-text').textContent = '正在准备...';
        document.getElementById('check-status-area').style.display = 'block';

        try {
            const res = await API.post('/check/run', { session_id: this.state.sessionId });
            if (res.status === 'ok') {
                this.state.result = res;
                this.showCheckResult(res);
                this.showToast(`检测完成！发现 ${res.total_issues} 个问题`, 'success');
            } else {
                this.showToast(res.message || '检测失败', 'error');
            }
        } catch (e) {
            this.showToast('检测请求失败', 'error');
        }

        btn.disabled = false;
        btn.textContent = '🔄 重新检测';
    },

    showCheckResult(result) {
        var bar = document.getElementById('check-progress-bar');
        bar.style.width = '100%';
        document.getElementById('check-progress-text').textContent =
            '检测完成：' + result.total_rows + ' 行数据 · ' + result.total_rules + ' 条规则 · 发现 ' + result.total_issues + ' 个问题';

        // 评分概览
        var levels = { '优秀': 'good', '良好': 'good', '一般': 'warn', '较差': 'bad' };
        var hl = result.health_level || { level: '-', color: '#999' };
        document.getElementById('check-summary').innerHTML =
            '<div class="score-big" style="color:' + hl.color + '">' + result.health_score + '%</div>'
            + '<div class="score-label">数据健康度：' + hl.level + '</div>'
            + '<div class="quick-stats">'
            + '<div class="qs-item"><span class="qs-num">' + result.total_rows + '</span> 总行数</div>'
            + '<div class="qs-item"><span class="qs-num" style="color:#e74c3c">' + result.total_issues + '</span> 问题数</div>'
            + '<div class="qs-item"><span class="qs-num">' + result.total_rules + '</span> 规则数</div>'
            + '</div>';

        // 清除多余区域
        document.getElementById('check-dims').innerHTML = '';
        var issuesSample = document.getElementById('check-issues-sample');
        if (issuesSample) issuesSample.innerHTML = '';

        // 仅显示有问题的规则
        var failedRules = (result.rule_results || []).filter(function(r) { return r.fail_count > 0; });
        if (failedRules.length > 0) {
            var rulesHtml = '<div class="section-title" style="font-size:0.9rem;margin-top:20px;">有问题的规则（' + failedRules.length + '条）</div>';
            rulesHtml += '<div class="table-wrap"><table class="report-table"><thead><tr><th>规则</th><th>维度</th><th>严重度</th><th>通过</th><th>失败</th></tr></thead><tbody>';
            failedRules.forEach(function(r) {
                rulesHtml += '<tr><td>' + r.rule_name + '</td><td>' + r.dimension + '</td>'
                    + '<td><span class="severity severity-' + r.severity + '">' + r.severity + '</span></td>'
                    + '<td>' + r.pass_count + '</td><td style="color:#e74c3c;font-weight:600">' + r.fail_count + '</td></tr>';
            });
            rulesHtml += '</tbody></table></div>';
            document.getElementById('check-rules-table').innerHTML = rulesHtml;
        } else {
            document.getElementById('check-rules-table').innerHTML = '<p class="hint">所有规则均通过，数据质量良好</p>';
        }

        document.getElementById('btn-next').disabled = false;
    },

    // ═══════════════════════════════════════════
    // Step 4: 查看报告
    // ═══════════════════════════════════════════

    async onEnterReport() {
        if (!this.state.sessionId) return;
        document.getElementById('report-loading').style.display = 'block';
        document.getElementById('report-content').style.display = 'none';

        try {
            var reportRes = await API.get('/report/' + this.state.sessionId);
            if (reportRes.status === 'ok') {
                this._reportData = reportRes.report;
                this._issuePage = 0;
                this._issueExpandedRules = {};
                this._issueGroupPages = {};
                this.renderReport(reportRes.report);
                // ECharts must be initialized after its containers are visible.
                document.getElementById('report-loading').style.display = 'none';
                document.getElementById('report-content').style.display = 'block';
            }
            var chartRes = await API.get('/report/' + this.state.sessionId + '/charts');
            if (chartRes.status === 'ok') {
                this.renderChartSection(chartRes);
            }
        } catch (e) {
            console.error('report error:', e);
        }
        document.getElementById('report-loading').style.display = 'none';
        document.getElementById('report-content').style.display = 'block';
    },

    renderReport(report) {
        var hl = this.getHealthLevel(report.health_score);

        // 统计卡片
        document.getElementById('summary-cards').innerHTML =
            '<div class="summary-card"><div class="sc-num" style="color:' + hl.color + '">' + report.health_score + '分</div><div class="sc-sub" style="color:' + hl.color + '">' + hl.level + '</div></div>' +
            '<div class="summary-card"><div class="sc-num">' + report.total_rows + '</div><div class="sc-lbl">数据总数</div></div>' +
            '<div class="summary-card"><div class="sc-num" style="color:#e74c3c">' + report.total_issues + '</div><div class="sc-lbl">问题总数</div></div>' +
            '<div class="summary-card"><div class="sc-num">' + report.total_rules + '</div><div class="sc-lbl">规则总数</div></div>';

        // 规则结果表
        var ruleHtml = '';
        (report.rule_results || []).filter(function(r) { return !r.skipped; }).forEach(function(r) {
            var hasIssue = r.fail_count > 0;
            ruleHtml += '<tr><td>' + r.rule_name + '</td><td>' + r.dimension + '</td>' +
                '<td><span class="severity severity-' + r.severity + '">' + r.severity + '</span></td>' +
                '<td>' + r.pass_count + '</td>' +
                '<td style="color:' + (hasIssue ? '#e74c3c' : '#52c41a') + '">' + r.fail_count + '</td></tr>';
        });
        document.getElementById('report-rules-table').innerHTML = ruleHtml;

        // 问题明细
        this.renderIssues(report);

        // 修复建议
        var recHtml = '';
        (report.recommendations || []).forEach(function(r) {
            recHtml += '<div class="rec-card"><span class="rec-badge rec-' + r.priority + '">' + r.priority + '</span>' +
                '<span class="rec-title">[' + r.category + '] ' + r.title + '</span>' +
                '<p class="rec-detail">' + r.detail + '</p></div>';
        });
        document.getElementById('report-recs').innerHTML = recHtml || '<p class="hint">暂无修复建议</p>';
    },

    // ── 问题清单：按规则分组、展开与组内分页 ──

    renderIssues(report) {
        var allIssues = report.issue_details || [];
        var listEl = document.getElementById('report-issues-list');
        var countEl = document.getElementById('report-issues-count');
        var dimensionEl = document.getElementById('issue-filter-dimension');
        var severityEl = document.getElementById('issue-filter-severity');
        var statusEl = document.getElementById('issue-filter-status');
        if (!listEl || !countEl || !dimensionEl || !severityEl || !statusEl) return;

        var selectedDimension = dimensionEl.value || 'all';
        var selectedSeverity = severityEl.value || 'all';
        var selectedStatus = statusEl.value || 'all';
        this.populateIssueFilter(dimensionEl, '全部维度', allIssues.map(function(i) { return i.dimension; }), selectedDimension);
        this.populateIssueFilter(severityEl, '全部严重性', allIssues.map(function(i) { return i.severity; }), selectedSeverity);

        var filtered = allIssues.filter(function(issue) {
            return (selectedDimension === 'all' || issue.dimension === selectedDimension)
                && (selectedSeverity === 'all' || issue.severity === selectedSeverity)
                && (selectedStatus === 'all' || selectedStatus === 'pending');
        });
        countEl.textContent = '（' + filtered.length + '条）';

        var groups = {};
        filtered.forEach(function(issue) {
            var key = issue.rule_id || issue.rule_name + '::' + issue.field;
            if (!groups[key]) groups[key] = { key: key, ruleName: issue.rule_name, ruleId: issue.rule_id || '', field: issue.field, dimension: issue.dimension, severity: issue.severity, issues: [] };
            groups[key].issues.push(issue);
        });
        var severityOrder = { '高': 0, '中': 1, '低': 2 };
        var groupList = Object.keys(groups).map(function(key) { return groups[key]; }).sort(function(a, b) {
            return (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || b.issues.length - a.issues.length;
        });

        if (!this._issueExpandedRules) this._issueExpandedRules = {};
        if (!this._issueGroupPages) this._issueGroupPages = {};
        if (groupList.length && Object.keys(this._issueExpandedRules).length === 0) this._issueExpandedRules[groupList[0].key] = true;

        listEl.innerHTML = groupList.length
            ? groupList.map(this.renderIssueGroup.bind(this)).join('')
            : '<p class="hint">暂无符合筛选条件的问题</p>';
    },

    populateIssueFilter(select, allLabel, values, selected) {
        var options = values.filter(function(value, index, items) { return value && items.indexOf(value) === index; });
        select.innerHTML = '<option value="all">' + allLabel + '</option>' + options.map(function(value) {
            return '<option value="' + value + '">' + value + '</option>';
        }).join('');
        select.value = options.indexOf(selected) >= 0 ? selected : 'all';
    },

    renderIssueGroup(group) {
        var pageSize = 8;
        var page = Math.max(0, Math.min(this._issueGroupPages[group.key] || 0, Math.ceil(group.issues.length / pageSize) - 1));
        this._issueGroupPages[group.key] = page;
        var totalPages = Math.ceil(group.issues.length / pageSize);
        var expanded = !!this._issueExpandedRules[group.key];
        var pageIssues = group.issues.slice(page * pageSize, (page + 1) * pageSize);
        var escapedKey = group.key.replace(/'/g, "\\'");
        var title = (group.ruleId ? group.ruleId + ' ' : '') + group.ruleName;
        var html = '<div class="issue-group">';
        html += '<div class="issue-group-header" onclick="App.toggleIssueGroup(\'' + escapedKey + '\')">';
        html += '<span class="issue-severity-badge ' + group.severity + '">' + group.severity + '</span>';
        html += '<div class="issue-group-info"><div class="issue-group-name">' + title + '</div><div class="issue-group-meta">' + group.field + ' · ' + group.dimension + ' · ' + group.issues.length + '条记录</div></div>';
        html += '<span class="issue-group-toggle">' + (expanded ? '▼ 收起' : '▶ 展开') + '</span></div>';
        if (expanded) {
            html += '<div class="issue-group-body"><div class="issue-group-summary">违规数据 ' + group.issues.length + ' 条（第 ' + (page * pageSize + 1) + '-' + Math.min((page + 1) * pageSize, group.issues.length) + ' 条）</div>';
            html += this.renderIssueDataTable(pageIssues, group.field);
            html += this.renderIssueGroupPages(escapedKey, page, totalPages);
            html += '</div>';
        }
        return html + '</div>';
    },

    renderIssueDataTable(issues, issueField) {
        var headers = [];
        issues.forEach(function(issue) {
            Object.keys(issue.row_data || {}).forEach(function(key) {
                if (headers.indexOf(key) === -1) headers.push(key);
            });
        });
        var html = '<div class="table-wrap"><table class="report-table issue-data-table"><thead><tr><th>行号</th>';
        headers.forEach(function(header) { html += '<th>' + header + '</th>'; });
        html += '</tr></thead><tbody>';
        issues.forEach(function(issue) {
            html += '<tr><td>' + issue.row_index + '</td>';
            headers.forEach(function(header) {
                var value = (issue.row_data || {})[header];
                var displayValue = value === undefined || value === null || value === '' ? 'NULL' : value;
                html += '<td class="' + (header === issueField ? 'issue-cell' : '') + '">' + displayValue + '</td>';
            });
            html += '</tr>';
        });
        return html + '</tbody></table></div>';
    },

    renderIssueGroupPages(key, page, totalPages) {
        if (totalPages <= 1) return '';
        var html = '<div class="issue-group-pages">';
        html += '<span class="issue-page-summary">第 ' + (page + 1) + ' / ' + totalPages + ' 页</span>';
        html += '<button class="issue-page-arrow" onclick="event.stopPropagation();App.goIssueGroupPage(\'' + key + '\',' + (page - 1) + ')" ' + (page === 0 ? 'disabled' : '') + '>上一页</button>';

        var pages = [0];
        for (var i = Math.max(1, page - 1); i <= Math.min(totalPages - 2, page + 1); i++) pages.push(i);
        if (totalPages > 1) pages.push(totalPages - 1);
        pages = pages.filter(function(value, index, values) { return values.indexOf(value) === index; }).sort(function(a, b) { return a - b; });

        var previous = -1;
        pages.forEach(function(pageNumber) {
            if (previous >= 0 && pageNumber - previous > 1) html += '<span class="issue-page-ellipsis">…</span>';
            html += '<button class="issue-page-dot ' + (pageNumber === page ? 'active' : '') + '" onclick="event.stopPropagation();App.goIssueGroupPage(\'' + key + '\',' + pageNumber + ')">' + (pageNumber + 1) + '</button>';
            previous = pageNumber;
        });
        html += '<button class="issue-page-arrow" onclick="event.stopPropagation();App.goIssueGroupPage(\'' + key + '\',' + (page + 1) + ')" ' + (page >= totalPages - 1 ? 'disabled' : '') + '>下一页</button></div>';
        return html;
    },

    toggleIssueGroup(key) {
        this._issueExpandedRules = this._issueExpandedRules || {};
        this._issueExpandedRules[key] = !this._issueExpandedRules[key];
        this.renderIssues(this._reportData);
    },

    goIssueGroupPage(key, page) {
        this._issueGroupPages = this._issueGroupPages || {};
        this._issueGroupPages[key] = page;
        this._issueExpandedRules = this._issueExpandedRules || {};
        this._issueExpandedRules[key] = true;
        this.renderIssues(this._reportData);
    },

    filterIssues() {
        this._issueGroupPages = {};
        this.renderIssues(this._reportData);
    },

    // ── 图表 ──

    renderChartSection(chartData) {
        // Render a dependency-free chart immediately. ECharts will enhance it
        // when the CDN is available, but the report remains usable offline.
        this.renderNativeCharts(chartData);

        var self = this;
        Charts.ensure(function() {
            var report = self._reportData;
            if (!report) return;

            // 按字段统计问题数
            var fieldCounts = {};
            (report.issue_details || []).forEach(function(i) {
                fieldCounts[i.field] = (fieldCounts[i.field] || 0) + 1;
            });
            var fieldArr = Object.keys(fieldCounts).map(function(k) {
                return { name: k, value: fieldCounts[k] };
            }).sort(function(a, b) { return b.value - a.value; }).slice(0, 10);

            // 颜色映射
            var dimColors = { '完整性': '#4a90d9', '准确性': '#52c41a', '一致性': '#e67e22', '逻辑性': '#e74c3c' };
            // 为每个字段找到其所属维度
            var fieldDim = {};
            (report.rule_results || []).forEach(function(r) {
                if (!fieldDim[r.field_name]) fieldDim[r.field_name] = r.dimension;
            });

            // 饼图：按维度
            var pieData = chartData.charts.pie_data || [];
            Charts.initPie('chart-pie');
            Charts.updatePie(pieData);

            // 柱状图：按字段 Top 10（横向）
            if (fieldArr.length > 0) {
                var barDom = document.getElementById('chart-bar');
                if (!barDom) return;
                Charts.initBar('chart-bar');
                var barChart = Charts.barChart;
                barChart.setOption({
                    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                    grid: { left: 120, right: 50, top: 10, bottom: 20 },
                    xAxis: { type: 'value', name: '问题数' },
                    yAxis: { type: 'category', data: fieldArr.map(function(d) { return d.name; }), inverse: true,
                        axisLabel: { width: 110, overflow: 'truncate' } },
                    series: [{
                        type: 'bar',
                        data: fieldArr.map(function(d) {
                            var dim = fieldDim[d.name] || '';
                            return { value: d.value, itemStyle: { color: dimColors[dim] || '#4a90d9',
                                borderRadius: [0, 6, 6, 0] } };
                        }),
                        barWidth: '60%',
                        label: { show: true, position: 'right', fontSize: 11 },
                    }],
                });
                Charts.barChart = barChart;
            }
        });
    },

    renderNativeCharts(chartData) {
        var report = this._reportData;
        if (!report) return;

        var pieEl = document.getElementById('chart-pie');
        var barEl = document.getElementById('chart-bar');
        if (!pieEl || !barEl) return;

        // Dispose old ECharts instances before reusing the containers for the
        // native fallback (for example, when the report is opened again).
        Charts.dispose();

        var colors = ['#4a90d9', '#52c41a', '#e67e22', '#e74c3c'];
        var pieData = (chartData.charts && chartData.charts.pie_data) || [];
        var total = pieData.reduce(function(sum, item) { return sum + item.value; }, 0);
        if (total > 0) {
            var radius = 54;
            var circumference = 2 * Math.PI * radius;
            var offset = 0;
            var circles = pieData.map(function(item, index) {
                var length = item.value / total * circumference;
                var circle = '<circle cx="80" cy="80" r="' + radius + '" fill="none" stroke="' + colors[index % colors.length] + '" stroke-width="24" stroke-dasharray="' + length + ' ' + (circumference - length) + '" stroke-dashoffset="-' + offset + '" transform="rotate(-90 80 80)"></circle>';
                offset += length;
                return circle;
            }).join('');
            var legend = pieData.map(function(item, index) {
                return '<span style="margin:0 8px 4px 0;display:inline-block;color:#666"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + colors[index % colors.length] + ';margin-right:4px"></i>' + item.name + ' ' + item.value + '</span>';
            }).join('');
            pieEl.innerHTML = '<div style="height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center"><svg viewBox="0 0 160 160" width="170" height="170" aria-label="按维度问题分布"><circle cx="80" cy="80" r="54" fill="none" stroke="#edf0f4" stroke-width="24"></circle>' + circles + '<text x="80" y="76" text-anchor="middle" font-size="25" font-weight="700" fill="#1a1f3a">' + total + '</text><text x="80" y="98" text-anchor="middle" font-size="12" fill="#888">问题数</text></svg><div style="font-size:12px;text-align:center;margin-top:5px">' + legend + '</div></div>';
        } else {
            pieEl.innerHTML = '<div class="hint">未发现问题，暂无维度分布图</div>';
        }

        var fieldCounts = {};
        (report.issue_details || []).forEach(function(issue) {
            fieldCounts[issue.field] = (fieldCounts[issue.field] || 0) + 1;
        });
        var fields = Object.keys(fieldCounts).map(function(name) {
            return { name: name, value: fieldCounts[name] };
        }).sort(function(a, b) { return b.value - a.value; }).slice(0, 10);

        if (fields.length > 0) {
            var maxValue = fields[0].value;
            barEl.innerHTML = '<div style="height:280px;padding:8px 4px;display:flex;flex-direction:column;justify-content:center;gap:9px">' + fields.map(function(item, index) {
                var width = Math.max(3, item.value / maxValue * 100);
                return '<div style="display:grid;grid-template-columns:100px 1fr 36px;gap:8px;align-items:center;font-size:12px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#555" title="' + item.name + '">' + item.name + '</span><span style="height:16px;background:#eaf1f8;border-radius:8px;overflow:hidden"><i style="display:block;height:100%;width:' + width + '%;background:' + colors[index % colors.length] + ';border-radius:8px"></i></span><b style="color:#555">' + item.value + '</b></div>';
            }).join('') + '</div>';
        } else {
            barEl.innerHTML = '<div class="hint">未发现问题，暂无字段分布图</div>';
        }
    },

    async downloadPDF() {
        if (!this.state.sessionId) return;
        window.open('/api/report/' + this.state.sessionId + '/pdf', '_blank');
    },

    // ── 工具方法 ──

    getHealthLevel(score) {
        if (score >= 90) return { level: '优秀', color: '#52c41a' };
        if (score >= 70) return { level: '良好', color: '#4a90d9' };
        if (score >= 50) return { level: '一般', color: '#e67e22' };
        return { level: '较差', color: '#e74c3c' };
    },

    scoreColor(score) {
        if (score >= 90) return '#52c41a';
        if (score >= 70) return '#4a90d9';
        if (score >= 50) return '#e67e22';
        return '#e74c3c';
    },

    showToast(msg, type) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.className = `toast toast-${type} show`;
        setTimeout(() => toast.classList.remove('show'), 3000);
    },

    showMsgModal(title, msg) {
        document.getElementById('msg-modal-title').textContent = '⚠ ' + title;
        document.getElementById('msg-modal-body').textContent = msg;
        document.getElementById('msg-modal').classList.add('show');
    },

    closeMsgModal() {
        document.getElementById('msg-modal').classList.remove('show');
    },
};

// ── 启动 ──
document.addEventListener('DOMContentLoaded', () => App.init());
