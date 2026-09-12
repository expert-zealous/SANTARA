import { defineConfig } from 'vite';
import obfuscator from 'rollup-plugin-obfuscator';

export default defineConfig({
  plugins: [
    obfuscator({
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      numbersToExpressions: true,
      simplify: true,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      splitStrings: true,
      unicodeEscapeSequence: false
    })
  ]
});