/**
 * Runtime stand-in for the `obsidian` module in unit tests. The real package
 * ships types only; Obsidian provides the module when the plugin loads. Only
 * what the modules under test touch at runtime is here.
 */
export class Notice {
  constructor(public message?: string) {}
}
