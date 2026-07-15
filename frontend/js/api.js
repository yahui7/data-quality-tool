/**
 * API 请求封装
 * 统一的 fetch 包装，错误处理
 */
const API = {
    base: '/api',

    async get(path) {
        const res = await fetch(this.base + path);
        return res.json();
    },

    async post(path, data) {
        const res = await fetch(this.base + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return res.json();
    },

    async upload(path, formData) {
        const res = await fetch(this.base + path, {
            method: 'POST',
            body: formData,
        });
        return res.json();
    },

    async put(path, data) {
        const res = await fetch(this.base + path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return res.json();
    },

    async del(path) {
        const res = await fetch(this.base + path, { method: 'DELETE' });
        return res.json();
    },
};
