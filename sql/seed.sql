insert into clients (id, client_type, name, phone)
values
  ('11111111-1111-1111-1111-111111111111', 'PHOTO_SESSION', 'Juan Pérez', '18095551234'),
  ('22222222-2222-2222-2222-222222222222', 'SCHOOL_GRADUATION', 'Colegio Santa María', '18095550000')
on conflict (id) do nothing;

insert into school_profiles (
  client_id, school_name, school_level, teacher_name, teacher_phone,
  principal_name, principal_phone, grade_or_class, student_count, follow_up_status,
  next_follow_up_date
) values (
  '22222222-2222-2222-2222-222222222222', 'Colegio Santa María',
  'KINDER', 'Laura Gómez', '18095551111', 'Marta Fernández', '18095552222', 'Kinder B', 35,
  'RECURRING_CLIENT', '2027-02-01'
);

insert into packages (id, name, package_type, description, price)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Sesión Básica', 'PHOTO_SESSION', 'Sesión sencilla con galería digital.', 4500),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Sesión Premium', 'PHOTO_SESSION', 'Sesión extendida con más fotos editadas.', 8000),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'Graduación Básica', 'SCHOOL_GRADUATION', 'Paquete escolar básico por estudiante.', 950),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'Graduación Premium', 'SCHOOL_GRADUATION', 'Paquete escolar premium por estudiante.', 1500)
on conflict (id) do nothing;

insert into jobs (
  id, client_id, package_id, job_type, title, event_type, event_date, delivery_date, status,
  price, package_quantity, approval_token
) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'PHOTO_SESSION', 'Sesión Familiar', 'Familiar', '2026-06-15', '2026-07-01', 'GALLERY_READY', 8000, 1, 'demo-sesion-juan-perez-2026'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'SCHOOL_GRADUATION', 'Graduación Kinder B 2026', 'Graduación', '2026-06-20', '2026-07-15', 'WAITING_APPROVAL', 52500, 35, 'demo-colegio-santa-maria-2026')
on conflict (id) do nothing;

insert into galleries (job_id, title, gallery_type, google_photos_url)
values
  ('33333333-3333-3333-3333-333333333333', 'Galería familiar', 'GENERAL', 'https://photos.app.goo.gl/demoSesion'),
  ('44444444-4444-4444-4444-444444444444', 'Galería de alumnos', 'STUDENT_GALLERY', 'https://photos.app.goo.gl/demoAlumnos'),
  ('44444444-4444-4444-4444-444444444444', 'Foto grupal', 'GROUP_PHOTO', 'https://photos.app.goo.gl/demoGrupo'),
  ('44444444-4444-4444-4444-444444444444', 'Documentación', 'DOCUMENTATION_FOLDER', 'https://photos.app.goo.gl/demoDocumentos'),
  ('44444444-4444-4444-4444-444444444444', 'Diploma', 'DIPLOMA', 'https://photos.app.goo.gl/demoDiploma');

insert into deposits (job_id, amount, deposit_date, notes)
values
  ('33333333-3333-3333-3333-333333333333', 3000, '2026-06-10', 'Abono entregado personalmente.'),
  ('44444444-4444-4444-4444-444444444444', 20000, '2026-06-12', 'Abono entregado personalmente.');
