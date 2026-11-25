// React 由宿主当 external 注入（package.json 的 dsh.client.external）。
// 打包成 CJS 后这里就是一句 require('react')，和拆分前的写法完全一致。
// 用 require 而不是 import：前端不引 @types/react，也不想被 esbuild 做 ESM 互操作包一层。
declare const require: (id: string) => any

const React: any = require('react')

export const useState = React.useState
export const useEffect = React.useEffect
export const useRef = React.useRef
export const useCallback = React.useCallback
export const useMemo = React.useMemo
export const Fragment = React.Fragment

export default React
