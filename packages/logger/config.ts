export const config = {
  defaults: {
    pageSize: 300,
  },
  settings: [
    { key: 'pageSize', type: 'number', label: '日志页一次显示多少条', min: 50, max: 500 },
  ],
}
