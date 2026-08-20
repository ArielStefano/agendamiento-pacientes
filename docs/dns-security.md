# Configuración DNS y Seguridad de Email

Guía para configurar registros DNS que protejan el dominio y mejoren la entregabilidad de emails de CliniAgenda.

## Prerequisitos
- Acceso al panel de administración del registrador de dominio
- El dominio debe estar delegado (nameservers apuntando al registrador o hosting)

---

## 1. SPF (Sender Policy Framework)

**Qué hace:** Autoriza qué servidores pueden enviar emails en nombre de tu dominio.

**Registro a agregar:**
```
Tipo: TXT
Nombre: @
Valor: v=spf1 include:_spf.google.com ~all
TTL: 3600
```

**Si usa otro proveedor de email:**
- Gmail/Google Workspace: `v=spf1 include:_spf.google.com ~all`
- Microsoft 365: `v=spf1 include:spf.protection.outlook.com ~all`
- Amazon SES: `v=spf1 include:amazonses.com ~all`
- Mailgun: `v=spf1 include:mailgun.org ~all`

---

## 2. DMARC (Domain-based Message Authentication)

**Qué hace:** Define qué hacer con emails que no pasen autenticación SPF/DKIM.

**Registro a agregar:**
```
Tipo: TXT
Nombre: _dmarc
Valor: v=DMARC1; p=quarantine; rua=mailto:admin@tudominio.com; pct=100
TTL: 3600
```

**Políticas disponibles (`p=`):**
- `none` — Solo reporta, no bloquea (recomendado para empezar)
- `quarantine` — Marca como sospechoso (recomendado después de 2 semanas)
- `reject` — Rechaza directamente (máxima seguridad)

**Recomendación:**
1. Empezar con `p=none` por 2 semanas
2. Revisar reportes en `rua`
3. Cambiar a `p=quarantine`
4. Si todo está bien, cambiar a `p=reject`

---

## 3. DKIM (DomainKeys Identified Mail)

**Qué hace:** Firma digitalmente los emails para verificar que no fueron modificados.

**Nota:** DKIM generalmente lo configura el proveedor de email (Google, Microsoft, etc.). Consulte la documentación de su proveedor.

**Google Workspace:**
1. Ir a Admin Console → Dominios → Añadir dominio
2. Copiar el registro TXT que te da Google
3. Agregarlo en DNS

**Registro típico:**
```
Tipo: TXT
Nombre: google._domainkey
Valor: v=DKIM1; k=rsa; p=MIGfMA0GCSq... (clave pública)
TTL: 3600
```

---

## 4. DNSSEC (DNS Security Extensions)

**Qué hace:** Firma criptográficamente los registros DNS para prevenir ataques de spoofing.

**Cómo habilitar:**
1. Ir al panel del registrador de dominio
2. Buscar "DNSSEC" o "Seguridad DNS"
3. Habilitar la opción
4. Copiar el DS record si se necesita delegar

**Nota:** No todos los registradores soportan DNSSEC. Verificar disponibilidad.

---

## 5. Registro MX (si aplica)

**Si el dominio recibe emails:**
```
Tipo: MX
Nombre: @
Valor: mail.tudominio.com (o el servidor de su proveedor)
Prioridad: 10
TTL: 3600
```

---

## Resumen de registros DNS a configurar

| Prioridad | Registro | Valor | ¿Quién lo usa? |
|-----------|----------|-------|-----------------|
| 🔴 Alta | SPF (TXT) | `v=spf1 include:_spf.google.com ~all` | Todos los proveedores |
| 🔴 Alta | DMARC (TXT) | `v=DMARC1; p=none; rua=mailto:admin@dominio.com` | Autenticación email |
| 🟡 Media | DKIM (TXT) | Según proveedor de email | Firma de emails |
| 🟡 Media | MX | Según proveedor de email | Recepción de emails |
| 🟢 Baja | DNSSEC | Habilitar en registrador | Seguridad DNS |

---

## Pasos recomendados

1. **Inmediato:** Configurar SPF + DMARC (p=none)
2. **1-2 semanas:** Revisar reportes DMARC
3. **Después:** Cambiar DMARC a p=quarantine
4. **Opcional:** Habilitar DNSSEC si el registrador lo soporta
5. **Verificar:** Usar https://www.mail-tester.com/ para probar entregabilidad
