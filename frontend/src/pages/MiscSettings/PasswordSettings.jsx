import React, { useState } from 'react';
import { Card, Form, Input, Button, message, Space, Divider, Alert, Row, Col, Tabs, Typography } from 'antd';
import { LockOutlined, KeyOutlined, CheckCircleOutlined, ExclamationCircleOutlined, UserOutlined, SettingOutlined } from '@ant-design/icons';
import { updateAdminPassword } from '@/utils/configManager';
import { useApiClient } from '@/hooks/useApiClient';

const { Text } = Typography;

// 유저 로그인 패스워드 변경 컴포넌트
const UserPasswordSection = ({ 
  userForm, 
  userLoading, 
  userFeedback, 
  setUserFeedback, 
  handleUserPasswordChange, 
  validateCurrentPassword, 
  validateUserPassword, 
  validateUserConfirmPassword 
}) => (
  <div style={{ padding: '24px 0' }}>
    <div style={{ marginBottom: '24px' }}>
      <Text style={{ fontSize: '16px', color: '#666' }}>
        시스템 로그인에 사용되는 패스워드를 변경합니다. 현재 로그인 패스워드만 있으면 변경할 수 있습니다.
      </Text>
    </div>

    {userFeedback && (
      <Alert
        message={userFeedback.message}
        type={userFeedback.type}
        showIcon
        icon={userFeedback.type === 'success' ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        closable
        onClose={() => setUserFeedback(null)}
        style={{ marginBottom: '24px' }}
      />
    )}

    <Row gutter={32}>
      <Col xs={24} lg={14}>
        <Form
          form={userForm}
          layout="vertical"
          onFinish={handleUserPasswordChange}
        >
          <Form.Item
            label="현재 로그인 패스워드"
            name="currentPassword"
            rules={[{ validator: validateCurrentPassword }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="현재 로그인 패스워드를 입력하세요"
              size="large"
              disabled={userLoading}
            />
          </Form.Item>

          <Form.Item
            label="새 로그인 패스워드"
            name="newPassword"
            rules={[{ validator: validateUserPassword }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="새 로그인 패스워드를 입력하세요"
              size="large"
              disabled={userLoading}
            />
          </Form.Item>

          <Form.Item
            label="새 로그인 패스워드 확인"
            name="confirmPassword"
            rules={[{ validator: validateUserConfirmPassword }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="새 로그인 패스워드를 다시 입력하세요"
              size="large"
              disabled={userLoading}
            />
          </Form.Item>

          <Form.Item style={{ marginTop: '32px' }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={userLoading}
              size="large"
              style={{ width: '100%' }}
              disabled={userLoading}
            >
              {userLoading ? '변경 중...' : '로그인 패스워드 변경'}
            </Button>
          </Form.Item>
        </Form>
      </Col>

      <Col xs={24} lg={10}>
        <div style={{ background: '#f8f9fa', padding: '20px', borderRadius: '8px', marginTop: '8px' }}>
          <h4 style={{ margin: '0 0 16px 0', color: '#343a40', fontSize: '14px', fontWeight: '600' }}>
            로그인 패스워드 요구사항
          </h4>
          <ul style={{ margin: 0, paddingLeft: '16px', color: '#6c757d', lineHeight: '1.8', fontSize: '14px' }}>
            <li>최소 4자 이상</li>
            <li>영문자, 숫자, 특수문자 사용 가능</li>
            <li>간단하게 설정 가능</li>
          </ul>
        </div>
      </Col>
    </Row>
  </div>
);

// 관리자 패스워드 변경 컴포넌트
const AdminPasswordSection = ({ 
  adminForm, 
  adminLoading, 
  adminFeedback, 
  setAdminFeedback, 
  handleAdminPasswordChange, 
  validateCurrentPassword, 
  validateAdminPassword, 
  validateAdminConfirmPassword 
}) => (
  <div style={{ padding: '24px 0' }}>
    <div style={{ marginBottom: '24px' }}>
      <Text style={{ fontSize: '16px', color: '#666' }}>
        시스템 관리 기능에 사용되는 관리자 패스워드를 변경합니다. 보안을 위해 복잡한 패스워드를 설정하세요.
      </Text>
    </div>

    {adminFeedback && (
      <Alert
        message={adminFeedback.message}
        type={adminFeedback.type}
        showIcon
        icon={adminFeedback.type === 'success' ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        closable
        onClose={() => setAdminFeedback(null)}
        style={{ marginBottom: '24px' }}
      />
    )}

    <Row gutter={32}>
      <Col xs={24} lg={14}>
        <Form
          form={adminForm}
          layout="vertical"
          onFinish={handleAdminPasswordChange}
        >
          <Form.Item
            label="현재 관리자 패스워드"
            name="currentPassword"
            rules={[{ validator: validateCurrentPassword }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="현재 관리자 패스워드를 입력하세요"
              size="large"
              disabled={adminLoading}
            />
          </Form.Item>

          <Form.Item
            label="새 관리자 패스워드"
            name="newPassword"
            rules={[{ validator: validateAdminPassword }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="새 관리자 패스워드를 입력하세요"
              size="large"
              disabled={adminLoading}
            />
          </Form.Item>

          <Form.Item
            label="새 관리자 패스워드 확인"
            name="confirmPassword"
            rules={[{ validator: validateAdminConfirmPassword }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="새 관리자 패스워드를 다시 입력하세요"
              size="large"
              disabled={adminLoading}
            />
          </Form.Item>

          <Form.Item style={{ marginTop: '32px' }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={adminLoading}
              size="large"
              style={{ width: '100%' }}
              disabled={adminLoading}
            >
              {adminLoading ? '변경 중...' : '관리자 패스워드 변경'}
            </Button>
          </Form.Item>
        </Form>
      </Col>

      <Col xs={24} lg={10}>
        <div style={{ background: '#f8f9fa', padding: '20px', borderRadius: '8px', marginTop: '8px' }}>
          <h4 style={{ margin: '0 0 16px 0', color: '#343a40', fontSize: '14px', fontWeight: '600' }}>
            관리자 패스워드 요구사항
          </h4>
          <ul style={{ margin: 0, paddingLeft: '16px', color: '#6c757d', lineHeight: '1.8', fontSize: '14px' }}>
            <li>최소 6자 이상</li>
            <li>영문자와 숫자 포함</li>
            <li>특수문자 사용 권장</li>
          </ul>
        </div>
      </Col>
    </Row>
  </div>
);

const PasswordSettings = () => {
  const [adminForm] = Form.useForm();
  const [userForm] = Form.useForm();
  const [adminLoading, setAdminLoading] = useState(false);
  const [userLoading, setUserLoading] = useState(false);
  const [adminFeedback, setAdminFeedback] = useState(null);
  const [userFeedback, setUserFeedback] = useState(null);
  const apiClient = useApiClient();

  // 관리자 패스워드 변경
  const handleAdminPasswordChange = async (values) => {
    setAdminLoading(true);
    setAdminFeedback(null);
    
    try {
      const result = await updateAdminPassword(values.currentPassword, values.newPassword);
      
      if (result.success) {
        setAdminFeedback({
          type: 'success',
          message: '관리자 패스워드가 성공적으로 변경되었습니다.'
        });
        message.success('관리자 패스워드가 성공적으로 변경되었습니다.');
        adminForm.resetFields();
      } else {
        setAdminFeedback({
          type: 'error',
          message: result.message || '관리자 패스워드 변경에 실패했습니다.'
        });
        message.error(result.message || '관리자 패스워드 변경에 실패했습니다.');
      }
    } catch (error) {
      console.error('관리자 패스워드 변경 오류:', error);
      const errorMessage = '관리자 패스워드 변경 중 오류가 발생했습니다.';
      setAdminFeedback({
        type: 'error',
        message: errorMessage
      });
      message.error(errorMessage);
    } finally {
      setAdminLoading(false);
    }
  };

  // 유저 로그인 패스워드 변경
  const handleUserPasswordChange = async (values) => {
    setUserLoading(true);
    setUserFeedback(null);
    
    try {
      const response = await apiClient.put('/api/config/login-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword
      });
      
      if (response.success) {
        setUserFeedback({
          type: 'success',
          message: '로그인 패스워드가 성공적으로 변경되었습니다.'
        });
        message.success('로그인 패스워드가 성공적으로 변경되었습니다.');
        userForm.resetFields();
      } else {
        setUserFeedback({
          type: 'error',
          message: response.message || '로그인 패스워드 변경에 실패했습니다.'
        });
        message.error(response.message || '로그인 패스워드 변경에 실패했습니다.');
      }
    } catch (error) {
      console.error('로그인 패스워드 변경 오류:', error);
      const errorMessage = '로그인 패스워드 변경 중 오류가 발생했습니다.';
      setUserFeedback({
        type: 'error',
        message: errorMessage
      });
      message.error(errorMessage);
    } finally {
      setUserLoading(false);
    }
  };

  const validateAdminPassword = (_, value) => {
    if (!value) {
      return Promise.reject(new Error('패스워드를 입력하세요.'));
    }
    if (value.length < 6) {
      return Promise.reject(new Error('패스워드는 최소 6자 이상이어야 합니다.'));
    }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(value)) {
      return Promise.reject(new Error('패스워드는 영문자와 숫자를 포함해야 합니다.'));
    }
    return Promise.resolve();
  };

  const validateUserPassword = (_, value) => {
    if (!value) {
      return Promise.reject(new Error('패스워드를 입력하세요.'));
    }
    if (value.length < 4) {
      return Promise.reject(new Error('패스워드는 최소 4자 이상이어야 합니다.'));
    }
    return Promise.resolve();
  };

  const validateAdminConfirmPassword = (_, value) => {
    if (!value) {
      return Promise.reject(new Error('패스워드 확인을 입력하세요.'));
    }
    if (value !== adminForm.getFieldValue('newPassword')) {
      return Promise.reject(new Error('패스워드가 일치하지 않습니다.'));
    }
    return Promise.resolve();
  };

  const validateUserConfirmPassword = (_, value) => {
    if (!value) {
      return Promise.reject(new Error('패스워드 확인을 입력하세요.'));
    }
    if (value !== userForm.getFieldValue('newPassword')) {
      return Promise.reject(new Error('패스워드가 일치하지 않습니다.'));
    }
    return Promise.resolve();
  };

  const validateCurrentPassword = (_, value) => {
    if (!value) {
      return Promise.reject(new Error('현재 패스워드를 입력하세요.'));
    }
    return Promise.resolve();
  };

  const tabItems = [
    {
      key: 'user-password',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UserOutlined />
          로그인 패스워드
        </span>
      ),
      children: (
        <UserPasswordSection
          userForm={userForm}
          userLoading={userLoading}
          userFeedback={userFeedback}
          setUserFeedback={setUserFeedback}
          handleUserPasswordChange={handleUserPasswordChange}
          validateCurrentPassword={validateCurrentPassword}
          validateUserPassword={validateUserPassword}
          validateUserConfirmPassword={validateUserConfirmPassword}
        />
      )
    },
    {
      key: 'admin-password',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SettingOutlined />
          관리자 패스워드
        </span>
      ),
      children: (
        <AdminPasswordSection
          adminForm={adminForm}
          adminLoading={adminLoading}
          adminFeedback={adminFeedback}
          setAdminFeedback={setAdminFeedback}
          handleAdminPasswordChange={handleAdminPasswordChange}
          validateCurrentPassword={validateCurrentPassword}
          validateAdminPassword={validateAdminPassword}
          validateAdminConfirmPassword={validateAdminConfirmPassword}
        />
      )
    }
  ];

  return (
    <Card 
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <KeyOutlined />
          <span>패스워드 설정</span>
        </div>
      }
      bordered
    >
      <Tabs 
        items={tabItems} 
        defaultActiveKey="user-password"
        size="large"
        tabBarStyle={{ marginBottom: '0' }}
      />
    </Card>
  );
};

export default PasswordSettings; 