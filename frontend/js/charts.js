/**
 * ECharts 图表管理 — 动态加载，避免阻塞页面
 */
const Charts = {
    pieChart: null,
    barChart: null,
    ready: false,
    _loading: false,
    _waitQueue: [],

    // ── 确保 ECharts 已加载 ──

    async ensure(cb) {
        if (this.ready) return cb();
        this._waitQueue.push(cb);
        if (this._loading) return;
        this._loading = true;

        // 动态加载 ECharts
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
        script.onload = () => {
            this.ready = true;
            this._waitQueue.forEach(fn => fn());
            this._waitQueue = [];
        };
        script.onerror = () => {
            console.warn('ECharts CDN 加载失败，图表功能不可用');
            this._waitQueue = [];
        };
        document.head.appendChild(script);
    },

    // ── 初始化 ──

    initPie(domId) {
        if (!this.ready) return;
        var el = document.getElementById(domId);
        if (el) this.pieChart = echarts.getInstanceByDom(el) || echarts.init(el);
    },

    initBar(domId) {
        if (!this.ready) return;
        var el = document.getElementById(domId);
        if (el) this.barChart = echarts.getInstanceByDom(el) || echarts.init(el);
    },

    // ── 更新数据 ──

    updatePie(pieData) {
        if (!this.ready || !this.pieChart) return;
        this.pieChart.setOption({
            tooltip: { trigger: 'item', formatter: '{b}: {c} 个 ({d}%)' },
            legend: { bottom: 10 },
            series: [{
                type: 'pie',
                radius: ['45%', '72%'],
                center: ['50%', '45%'],
                avoidLabelOverlap: false,
                itemStyle: {
                    borderRadius: 6,
                    borderColor: '#fff',
                    borderWidth: 3,
                },
                label: { show: false },
                emphasis: {
                    label: { show: true, fontSize: 16, fontWeight: 'bold' },
                },
                data: pieData,
                color: ['#4a90d9', '#52c41a', '#e67e22', '#e74c3c'],
            }],
        });
    },

    updateBar(barData) {
        if (!this.ready || !this.barChart) return;
        this.barChart.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: ['得分', '问题数'], bottom: 0 },
            grid: { left: 50, right: 50, top: 40, bottom: 40 },
            xAxis: { type: 'category', data: barData.categories },
            yAxis: [
                { type: 'value', name: '得分', max: 100, axisLabel: { formatter: '{value}%' } },
                { type: 'value', name: '问题数' },
            ],
            series: [
                {
                    name: '得分',
                    type: 'bar',
                    data: barData.scores,
                    itemStyle: {
                        borderRadius: [6, 6, 0, 0],
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: '#4a90d9' },
                            { offset: 1, color: '#7eb8da' },
                        ]),
                    },
                    barWidth: '40%',
                },
                {
                    name: '问题数',
                    type: 'bar',
                    yAxisIndex: 1,
                    data: barData.issues,
                    itemStyle: {
                        borderRadius: [6, 6, 0, 0],
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: '#e67e22' },
                            { offset: 1, color: '#f0c78e' },
                        ]),
                    },
                    barWidth: '40%',
                },
            ],
        });
    },

    dispose() {
        if (this.pieChart) this.pieChart.dispose();
        if (this.barChart) this.barChart.dispose();
        this.pieChart = null;
        this.barChart = null;
    },

    // ── resize ──

    resize() {
        if (this.pieChart) this.pieChart.resize();
        if (this.barChart) this.barChart.resize();
    },
};

window.addEventListener('resize', () => Charts.resize());
