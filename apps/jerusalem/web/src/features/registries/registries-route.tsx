import { useParams, type LoaderFunctionArgs } from 'react-router';

import * as list from './registries-page.tsx';
import * as one from './registry-page.tsx';

/** One lazy route for the list of registries and for one registry, keeping the first load small. */
export function loader(args: LoaderFunctionArgs) {
  return args.params.version ? one.loader(args) : list.loader();
}

export function Component() {
  return useParams().version ? <one.RegistryPage /> : <list.RegistriesPage />;
}
