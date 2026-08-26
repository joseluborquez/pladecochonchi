# Seguimiento PLADECO — Municipalidad de Chonchi

Aplicación web estática de demostración para consultar la cartera PLADECO, visualizar sus avances y revisar las tareas de cada proyecto.

## Despliegue en Vercel

Este repositorio no requiere compilación ni variables de entorno para la demostración actual. En Vercel, importa el repositorio y deja el ajuste **Framework Preset** en `Other`; el directorio de salida es la raíz del proyecto.

Los datos cargados provienen del libro de gestión PLADECO y están incluidos en `data.js`. Esta versión es una maqueta local; para habilitar edición persistente, usuarios y permisos se debe conectar con Supabase.
