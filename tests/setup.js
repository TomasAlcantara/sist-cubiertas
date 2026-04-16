// Variables de entorno para tests — usa valores falsos, nunca prod
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-solo-para-jest-no-usar-en-produccion';
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
