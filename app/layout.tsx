import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '同学 · 一起想，一起答', description: '一个清爽的小课堂。输入名字加入，独立思考，等所有同学提交后一起揭晓答案。', icons: { icon: '/favicon.svg' } };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
