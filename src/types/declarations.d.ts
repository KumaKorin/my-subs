declare module '*.html' {
    const content: string
    export default content
}

declare module '*.css' {
    const content: string
    export default content
}

declare module '*.client.js' {
    const content: string
    export default content
}

declare module '*.yaml' {
    const content: string
    export default content
}

interface Window {
    __BASE_PREFIX__?: string
    jsyaml?: any
}
