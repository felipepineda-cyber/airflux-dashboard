# Norma Background: filtros, ViewIA y PDF

## Excel

Una fila por bitácora, 25 columnas. Folio y localidad comunes; dos bloques de 11 columnas para MP2,5 y MP10 (filtro, impactador, operador, fechas inicial/final, horas inicial/final, rotámetros inicial/final y horómetros inicial/final); observaciones. Los filtros se exportan como texto para preservar ceros iniciales. Los datos numéricos conservan cero. Los registros antiguos sin filtro no se modifican y salen con celda vacía. Se mantiene el formato XML Spreadsheet .xls y la descarga existente.

## ViewIA (Beta)

Nueva sección de lectura de PNG/JPEG/WebP/BMP. OCR local con Tesseract.js 6.0.1, español/inglés; descarga motor/idiomas al leer. Las imágenes no se envían a un servicio de reconocimiento. Se requiere conexión inicial para los recursos CDN. La escritura manuscrita o de baja calidad puede no reconocerse. No usa GPT ni necesita clave API.

El usuario compara imagen/texto, corrige valores, cambia destinos y selecciona propuestas. Al aceptar se prepara un nuevo borrador, previa confirmación si ya había datos sin guardar. No se guardan bitácoras ni se sincronizan hasta el guardado normal. No se asignan lecturas cuando un encabezado contiene ambos contaminantes ni cuando varias cifras compiten por un único extremo. Los filtros admiten puntuación como AB.001 sin truncarlos. No se redondean minutos como 08:07 a múltiplos de cinco.

## PDF

Se reemplazaron los tres generadores: bitácora individual, informe general e informe por localidad. Se eliminan flechas incompatibles con la fuente PDF y se separan columnas de inicio/final. Se ajustan valores largos, se conservan observaciones completas y ceros, se repiten encabezados en páginas nuevas y se numeran páginas. Informes generales/locales en A4 horizontal; bitácoras en A4 vertical. Se usa la paleta de SenFePin.

Se inspeccionó Downloads/Copiapó_11.pdf y se detectó codificación nula/flecha inválida en fechas, horas y lecturas. Se generó y renderizó output/pdf/Copiapo_11_corregido.pdf con los mismos datos; revisión visual conforme: una página ordenada, sin caracteres corruptos. Este PDF de usuario y los archivos de .preview quedan fuera del commit.

## Verificación

`node --test tests/*.test.cjs`: 16 pruebas pasan. XML Excel analizado con ElementTree: 25 columnas y correspondencias independientes de filtros/fechas/horas. Pruebas de formularios incluyen aceptar, cancelar y texto cambiado. Pruebas PDF cubren ceros, encabezados, múltiples páginas y límites de dibujo. Inspección visual del PDF descargado del navegador realizada. ViewIA se revisó en Chrome y aceptar ocho sugerencias rellenó el formulario con filtros distintos y hora 08:07, sin guardar ni sincronizar. Se ejecutó OCR real sobre una imagen renderizada de la bitácora: extrajo texto, pero omitió encabezados y confundió un apellido. La aplicación exige revisión y no asigna campos sin contaminante. Vista móvil no verificada; no se declara validación de manuscritos.

## Publicación

Se preservaron los metadatos del archivo actual de GitHub descargado el 13 de noviembre de 2026. Las modificaciones funcionales están en norma.html, norma-tools.js, norma-pdf.js, viewia.js y viewia.css. La base de datos conserva su estructura: filtro ya existía en mp25/mp10. No se requiere migración Supabase.
