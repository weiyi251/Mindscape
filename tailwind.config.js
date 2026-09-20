/**
 * Tailwind CSS 配置（Tailwind v3，对应 17.1 锁定项）。
 * 配色来源：开发计划书第十二章「配色与视觉规范」。
 * 低饱和自然色系，UI 克制、不抢内容焦点。
 */
import tailwindcssAnimate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // shadcn/ui 语义色（值由 CSS 变量提供，见 src/styles/globals.css）
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // 便签纸（2026-09-13）：语义色，浅色淡黄 / 深色暗琥珀灰，见 globals.css --note
        note: 'hsl(var(--note))',
        // 待办强调琥珀（2026-09-17）：待办卡插件的虚线框 / 复选框 / 连线点，见 globals.css --todo
        todo: 'hsl(var(--todo))',
        // ⚠️ 这里曾有一组 `canvas` 原始色值（第十二章的 #F5F3EF / #5A7D6A …）。
        //    2026-09-20 D1 深色走查时删除：全项目零引用，而且这类**写死的色值不随
        //    主题变化** —— 一旦有人引用，深色模式下就会露出一块米白（D1 要防的正是
        //    这类陷阱）。画布侧需要原始色值时，请走 globals.css 的语义变量，
        //    例如 MiniMap.tsx 的 cssColor('--primary', …)：语义变量优先、hex 仅兜底。
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
