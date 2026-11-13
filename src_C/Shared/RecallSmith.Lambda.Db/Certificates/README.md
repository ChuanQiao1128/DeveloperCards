# RDS PostgreSQL trust roots

`ap-southeast-2-bundle.pem` is the unmodified AWS RDS regional bundle downloaded on 2026-11-13 from:
https://truststore.pki.rds.amazonaws.com/ap-southeast-2/ap-southeast-2-bundle.pem

SHA-256: `d73890748b5a95551800df8a6f07c9c800e32ed34da7e6c9505918bf8ac2398b`.

The three self-signed roots are Amazon RDS ap-southeast-2 Root CA:

| Root | Valid from (UTC) | Valid until (UTC) |
| --- | --- | --- |
| RSA2048 G1 | 2021-05-24 20:42:33 | 2061-05-24 21:42:33 |
| ECC384 G1 | 2021-05-24 20:50:15 | 2121-05-24 21:50:15 |
| RSA4096 G1 | 2021-05-24 20:46:18 | 2121-05-24 21:46:18 |

The default local OpenSSL trust store did not trust these roots. The shared Db project copies this bundle into both VPC and Worker publish output at `Certificates/ap-southeast-2-bundle.pem`. Production defaults to VerifyFull and this bundled trust file; the committed deployment environment sets both explicitly. No runtime download or certificate-validation callback is used.

Refresh from the same AWS public truststore through the normal reviewed build before a CA change or expiry. Record the replacement hash and validity, rerun TLS rejection tests, and verify both Lambda archives contain the identical file. Live RDS hostname/certificate compatibility must be checked during the authorized deployment; local generated certificates do not prove the live endpoint configuration.
