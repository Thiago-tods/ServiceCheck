/// Build-time configuration. Override with `--dart-define=API_BASE_URL=https://host/api/v1`.
class AppConfig {
  const AppConfig._();

  /// Android emulators reach the host machine at 10.0.2.2.
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000/api/v1',
  );
}