# @gloseije/nestjs-chariow

Intégration NestJS (10, 11, 12) du SDK [`@gloseije/chariow-sdk`](../core) : `ChariowModule.forRoot()` /
`forRootAsync()`, `ChariowService` injectable, `ChariowPulseGuard` et décorateur `@ChariowPulse()` pour
recevoir les Pulses Chariow signés.

```ts
ChariowModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    apiKey: config.getOrThrow('CHARIOW_API_KEY'),
    pulseSecret: config.getOrThrow('CHARIOW_PULSE_SECRET'),
  }),
});
```

Documentation complète (en français) : voir le README du monorepo.
Licence MIT. Projet non affilié à Chariow.
