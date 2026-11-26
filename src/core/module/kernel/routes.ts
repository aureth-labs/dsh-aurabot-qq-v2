export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type RouteAccess = 'panel' | null
export interface RouteOptions { method: HttpMethod; access?: RouteAccess }

interface Endpoint {
  handler: (req, res) => unknown
  access: RouteAccess
}
interface OwnedPath {
  id: string
  methods: Map<string, Endpoint>
}

export class ModuleRoutes extends Map<string, OwnedPath> {
  register(path: string, id: string, method: HttpMethod, endpoint: Endpoint) {
    const row = this.get(path) ?? { id, methods: new Map<string, Endpoint>() }
    if (row.id !== id) throw new Error(`接口 ${path} 已由模块「${row.id}」注册`)
    if (row.methods.has(method)) throw new Error(`接口 ${method} ${path} 重复注册`)
    row.methods.set(method, endpoint)
    this.set(path, row)
    return () => {
      if (this.get(path) !== row || row.methods.get(method) !== endpoint) return
      row.methods.delete(method)
      if (!row.methods.size) this.delete(path)
    }
  }

  removeOwner(id: string) {
    for (const [path, row] of this) if (row.id === id) this.delete(path)
  }

  access(path: string, method = 'GET') {
    return this.get(path)?.methods.get(method.toUpperCase())?.access ?? null
  }

  async handle(path: string, req, res) {
    const row = this.get(path)
    if (!row) return { ok: false, message: '该插件接口未启用', moduleOff: true }
    const endpoint = row.methods.get(String(req?.method || 'GET').toUpperCase())
    if (endpoint) return endpoint.handler(req, res)
    const allowed = [...row.methods.keys()].join(', ')
    if (res) {
      res.statusCode = 405
      res.setHeader?.('Allow', allowed)
    }
    return { ok: false, code: 'METHOD_NOT_ALLOWED', message: '此接口接受 ' + allowed }
  }
}
