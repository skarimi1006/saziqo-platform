// CLAUDE: DI token for the module list consumed by ModuleLoaderService.
// Bound in ModuleRegistryModule to the static MODULES array exported from
// apps/api/src/modules.config.ts. Tests rebind it to a controlled list.
export const MODULES_LIST = Symbol('MODULES_LIST');
