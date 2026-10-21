/**
 * 后台页面标题区：眉标、标题、说明、右侧操作。
 *
 * 实现只有一份，留在 `admin-page.tsx`（已有二十个栏目在引用）；这里把它挂到
 * `layout/` 这个统一入口下，新页面从 `@/components/admin/layout` 取原语，
 * 不再各自拼标题区，也不会出现第二套标题样式。
 */
export {AdminPageHeader, type AdminPageHeaderProps} from '../admin-page';
