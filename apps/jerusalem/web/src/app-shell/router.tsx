import { createHashRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from './routes.tsx';

/** Call only after the entry has consumed an authentication callback fragment. */
export function createAdminRouter() {
  return createHashRouter(routes);
}
interface Props {
  router: ReturnType<typeof createAdminRouter>;
}
export function AppRouter({ router }: Props) {
  return <RouterProvider router={router} />;
}
