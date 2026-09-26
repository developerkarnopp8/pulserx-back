module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  // Sem plugin:prettier/recommended de propósito: o código nunca teve um .prettierrc,
  // então ligar "formatação como erro de lint" reformataria o projeto inteiro (largura
  // de linha, quebra de import) no primeiro `npm run lint` — ruído gigante fora do
  // escopo de configurar CI. `npm run format` (prettier direto) continua disponível
  // pra quem quiser formatar; lint fica focado em problema real (var não usada, etc.).
  extends: ['plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
  },
};
