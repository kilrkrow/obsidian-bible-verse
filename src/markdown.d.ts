// CHANGELOG.md is bundled as a string by esbuild's text loader (esbuild.config.mjs).
declare module "*.md" {
  const content: string;
  export default content;
}
