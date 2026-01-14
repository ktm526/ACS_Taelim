import React, { useState } from 'react';
import { Card, Form, Input, Button, message, Typography, Layout, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAtom } from 'jotai';
import { sessionIdAtom, isLoggedInAtom, userInfoAtom } from '@/state/atoms';
import { useApiClient } from '@/hooks/useApiClient';
import logo from '@/assets/logo.png';

const { Title } = Typography;
const { Content } = Layout;

export default function Login() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [, setSessionId] = useAtom(sessionIdAtom);
  const [, setIsLoggedIn] = useAtom(isLoggedInAtom);
  const [, setUserInfo] = useAtom(userInfoAtom);
  const apiClient = useApiClient();

  const handleLogin = async (values) => {
    setLoading(true);
    setLoginError(null);
    
    try {
      const response = await apiClient.post('/api/config/login', {
        password: values.password
      });

      if (response.success) {
        const sessionId = response.sessionId;
        
        // 세션 ID를 localStorage와 상태에 저장
        localStorage.setItem('sessionId', sessionId);
        setSessionId(sessionId);
        setIsLoggedIn(true);
        setUserInfo({
          userType: 'user',
          loginTime: new Date().toISOString()
        });

        message.success('로그인되었습니다.');
      } else {
        // 패스워드 오류 피드백
        const errorMessage = response.message || '로그인에 실패했습니다.';
        setLoginError(errorMessage);
        
        // 패스워드 필드에 에러 표시
        form.setFields([
          {
            name: 'password',
            errors: [errorMessage],
          },
        ]);
        
        message.error(errorMessage);
      }
    } catch (error) {
      console.error('로그인 오류:', error);
      const errorMessage = '비밀번호가 잘못되었습니다';
      setLoginError(errorMessage);
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 패스워드 입력 시 에러 상태 초기화
  const handlePasswordChange = () => {
    if (loginError) {
      setLoginError(null);
      form.setFields([
        {
          name: 'password',
          errors: [],
        },
      ]);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Card 
          style={{ 
            width: 400, 
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            borderRadius: 8
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img 
              src={logo} 
              alt="ELLO" 
              style={{ height: 48, marginBottom: 16 }} 
            />

          </div>

          {/* 로그인 실패 알림 */}
          {loginError && (
            <Alert
              message="로그인 실패"
              description={loginError}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              closable
              onClose={() => setLoginError(null)}
            />
          )}

          <Form
            form={form}
            onFinish={handleLogin}
            layout="vertical"
            size="large"
          >
            <Form.Item
              name="password"
              rules={[
                { required: true, message: '패스워드를 입력해주세요.' },
                { min: 4, message: '패스워드는 최소 4자 이상이어야 합니다.' }
              ]}
              validateStatus={loginError ? 'error' : ''}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="패스워드를 입력하세요"
                autoComplete="current-password"
                onChange={handlePasswordChange}
                onPressEnter={() => form.submit()}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={{ height: 48 }}
              >
                {loading ? '로그인 중...' : '로그인'}
              </Button>
            </Form.Item>
          </Form>

          <div style={{ 
            textAlign: 'center', 
            marginTop: 16, 
            fontSize: 12, 
            color: '#999' 
          }}>
            시스템 접근을 위해 로그인이 필요합니다.
          </div>
        </Card>
      </Content>
    </Layout>
  );
} 