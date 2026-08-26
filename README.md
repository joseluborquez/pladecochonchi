# Seguimiento PLADECO — Municipalidad de Chonchi

Aplicación web estática conectada a Supabase: inicio de sesión, roles, RLS, cartera de proyectos, actualización de tareas, avance calculado automáticamente, exportación CSV e importación inicial de la cartera incluida.

## Puesta en marcha

1. Crea un proyecto en [Supabase](https://supabase.com) y ejecuta el contenido completo de `supabase.sql` desde **SQL Editor**.
2. En **Authentication > Users**, crea el primer usuario administrador.
3. Ejecuta en SQL Editor, reemplazando el UUID por el ID de ese usuario:

```sql
insert into public.profiles (id, nombre_completo, rol)
values ('UUID_DEL_USUARIO', 'Administrador SECPLAN', 'admin');
```

4. Copia `config.example.js` como `config.js` y agrega la **Project URL** y la **anon key** de Supabase. La anon key es pública por diseño; nunca uses la service-role key en el navegador.
5. Inicia sesión con el administrador, ve a **Administración** e importa la cartera PLADECO una sola vez.
6. Para crear más usuarios, créalos en Supabase Authentication y agrega/actualiza su fila en `profiles` con su unidad y rol. Las reglas RLS ya restringen las tareas al dueño de cada proyecto.

## Vercel

Importa el repositorio, selecciona el preset **Other** y deja el directorio de salida en la raíz. Incluye `config.js` en el repositorio o súbelo como archivo del proyecto antes de desplegar: una aplicación estática no puede leer variables de entorno de Vercel directamente desde el navegador.

## Reglas implementadas

- Proyecto: avance = suma de avance × ponderador de sus tareas.
- El avance y la diferencia del proyecto se actualizan por trigger PostgreSQL.
- El presupuesto de tareas no puede superar el presupuesto del proyecto.
- Una tarea pagada exige comprobante; sin pago, el comprobante se elimina.
- UTR puede leer todo y modificar tareas de su unidad; admin gestiona toda la cartera y catálogos.

Durante la importación, el presupuesto repetido por etapa en el Excel se distribuye según el ponderador, para respetar la regla de presupuesto total por proyecto.
