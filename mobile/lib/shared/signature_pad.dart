import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

class SignatureController extends ChangeNotifier {
  final List<List<Offset>> _strokes = [];
  Size _size = Size.zero;

  bool get isEmpty => _strokes.isEmpty;
  List<List<Offset>> get strokes => List.unmodifiable(_strokes);

  void start(Offset p) {
    _strokes.add([p]);
    notifyListeners();
  }

  void extend(Offset p) {
    if (_strokes.isEmpty) return;
    _strokes.last.add(p);
    notifyListeners();
  }

  void clear() {
    _strokes.clear();
    notifyListeners();
  }

  /// Renders the strokes to a small black-on-white PNG (the server accepts up to 256 KB).
  Future<Uint8List> toPng({int width = 600, int height = 240}) async {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawRect(Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()), Paint()..color = Colors.white);
    final sx = _size.width == 0 ? 1.0 : width / _size.width;
    final sy = _size.height == 0 ? 1.0 : height / _size.height;
    final paint = Paint()
      ..color = Colors.black
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final stroke in _strokes) {
      if (stroke.length == 1) {
        canvas.drawCircle(Offset(stroke.first.dx * sx, stroke.first.dy * sy), 1.5, paint..style = PaintingStyle.fill);
        paint.style = PaintingStyle.stroke;
        continue;
      }
      final path = Path()..moveTo(stroke.first.dx * sx, stroke.first.dy * sy);
      for (final p in stroke.skip(1)) {
        path.lineTo(p.dx * sx, p.dy * sy);
      }
      canvas.drawPath(path, paint);
    }
    final image = await recorder.endRecording().toImage(width, height);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data!.buffer.asUint8List();
  }
}

class SignaturePad extends StatelessWidget {
  const SignaturePad({super.key, required this.controller, this.height = 200});
  final SignatureController controller;
  final double height;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: scheme.outline),
        borderRadius: BorderRadius.circular(6),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          controller._size = Size(constraints.maxWidth, constraints.maxHeight);
          return GestureDetector(
            key: const Key('signature-pad'),
            behavior: HitTestBehavior.opaque,
            onPanStart: (d) => controller.start(d.localPosition),
            onPanUpdate: (d) => controller.extend(d.localPosition),
            child: ListenableBuilder(
              listenable: controller,
              builder: (context, _) => CustomPaint(
                size: Size.infinite,
                painter: _PadPainter(controller.strokes),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _PadPainter extends CustomPainter {
  _PadPainter(this.strokes);
  final List<List<Offset>> strokes;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.black
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final stroke in strokes) {
      if (stroke.length < 2) continue;
      final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
      for (final p in stroke.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_PadPainter old) => true;
}