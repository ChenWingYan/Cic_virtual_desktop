/** 文件列表中的可序列化项目。 */
export interface FileEntry { name:string; path:string; kind:'directory'|'file'|'link'|'unavailable'; size:number; modified:number }
/** 主进程发布的目录及磁盘快照。 */
export interface FilesSnapshot { roots?:{name:string;path:string}[]; directory?:{path:string;entries:FileEntry[]}|null; error?:string }
/** 有界的文件变更请求，主进程重新验证所有路径。 */
export interface FileOperation { kind:'mkdir'|'rename'|'copy'|'move'|'delete'; directory?:string; name?:string; sources?:string[] }
/** 文件传输结果包含部分完成情况。 */
export interface FileResult { completed:string[]; skipped:string[]; error:string }
/** 需要用户明确选择的冲突或删除问题。 */
export interface FileQuestion { id:string; kind:'conflict'|'delete'|'permanent'; message:string }
