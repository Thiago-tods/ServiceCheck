import 'package:flutter/widgets.dart';

import '../l10n/gen/app_localizations.dart';

export '../l10n/gen/app_localizations.dart';

extension L10nContext on BuildContext {
  AppL10n get l10n => AppL10n.of(this);
}

String statusLabel(AppL10n l, String status) => switch (status) {
      'OPEN' => l.statusOPEN,
      'SCHEDULED' => l.statusSCHEDULED,
      'IN_PROGRESS' => l.statusIN_PROGRESS,
      'SIGNATURE_REVIEW' => l.statusSIGNATURE_REVIEW,
      'PENDING_APPROVAL' => l.statusPENDING_APPROVAL,
      'APPROVED' => l.statusAPPROVED,
      'CANCELLED' => l.statusCANCELLED,
      _ => status,
    };

String roleLabel(AppL10n l, String role) => switch (role) {
      'OWNER' => l.role_OWNER,
      'ADMIN' => l.role_ADMIN,
      'RECEPTIONIST' => l.role_RECEPTIONIST,
      'PROFESSIONAL' => l.role_PROFESSIONAL,
      _ => role,
    };