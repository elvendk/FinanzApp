# 📊 KePago! - Gestor Personal de Finanzas

Una aplicación web **100% estática y Serverless** para gestionar tus gastos, cuotas y deudas, diseñada para ejecutarse íntegramente en tu navegador sin requerir base de datos o backend en la nube.

## 🚀 Características Principales
- **Arquitectura Local:** Todos los datos se guardan en el `localStorage` de tu navegador. Máxima privacidad.
- **Importador Inteligente de PDFs:** Extrae automáticamente las transacciones desde estados de cuenta bancarios utilizando `pdf.js`. Transforma los montos y extrae las fechas inteligentemente.
- **Gestión de Cuotas:** Calcula automáticamente la cuota que te toca pagar este mes ("1 de 12", etc.), incluso en meses futuros.
- **División de Gastos:** Personaliza exactamente quién paga qué % de cada gasto (Personas personalizables con colores).
- **Acciones Masivas (Bulk Actions):** Selecciona múltiples transacciones para eliminarlas en masa o fusionarlas en una súper-transacción agrupadora.
- **Portabilidad:** Exporta e importa copias de seguridad en formato `.json` al instante para mover tus datos entre tu PC y tu teléfono celular.

## 📱 Cómo probarlo
Dado que no necesita servidor:
1. Simplemente descarga o clona este repositorio.
2. Abre el archivo `KePago.html` (o `index.html`) en tu navegador web.
3. ¡Comienza a añadir transacciones o a importar el estado de tu tarjeta!

> **Nota para PWA:** También puedes alojarlo fácilmente en plataformas gratuitas como GitHub Pages, Netlify o Vercel para entrar a la app desde cualquier lugar.

## 🔧 Tecnologías
- HTML5, CSS3, JavaScript Vainilla
- **[pdf.js](https://mozilla.github.io/pdf.js/)** para la carga, lectura y mapeo de coordenadas X/Y en estados de cuenta PDF localmente.
- Diseño minimalista y moderno, enfocado en Single-Page Apps (SPA).
